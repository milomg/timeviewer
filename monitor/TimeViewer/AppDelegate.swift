//
//  AppDelegate.swift
//  TimeViewer
//
//  Created by Milo on 8/28/21.
//

import Cocoa
import ScriptingBridge
import Starscream

@objc protocol TabThing {
  @objc optional var URL: String { get }
  @objc optional var title: String { get }
}

@objc protocol WindowThing {
  @objc optional var activeTab: TabThing { get }
  @objc optional var mode: String { get }
}

extension SBObject: WindowThing, TabThing {}

@objc protocol ChromeThing {
  @objc optional func windows() -> [WindowThing]
}

extension SBApplication: ChromeThing {}

struct NetworkMessageThing: Codable {
  var app: String
  var title: String
  var url: String?
}

public func SystemIdleTime() -> Double? {
  var iterator: io_iterator_t = 0
  defer { IOObjectRelease(iterator) }
  guard
    IOServiceGetMatchingServices(kIOMasterPortDefault, IOServiceMatching("IOHIDSystem"), &iterator)
      == KERN_SUCCESS
  else {
    return nil
  }

  let entry: io_registry_entry_t = IOIteratorNext(iterator)
  defer { IOObjectRelease(entry) }
  guard entry != 0 else { return nil }

  var unmanagedDict: Unmanaged<CFMutableDictionary>? = nil
  defer { unmanagedDict?.release() }
  guard
    IORegistryEntryCreateCFProperties(entry, &unmanagedDict, kCFAllocatorDefault, 0) == KERN_SUCCESS
  else { return nil }
  guard let dict = unmanagedDict?.takeUnretainedValue() else { return nil }

  let key: CFString = "HIDIdleTime" as CFString
  let value = CFDictionaryGetValue(dict, Unmanaged.passUnretained(key).toOpaque())
  let number: CFNumber = unsafeBitCast(value, to: CFNumber.self)
  var nanoseconds: Int64 = 0
  guard CFNumberGetValue(number, CFNumberType.sInt64Type, &nanoseconds) else { return nil }
  let interval = Double(nanoseconds) / Double(NSEC_PER_SEC)

  return interval
}

@main
class AppDelegate: NSObject, NSApplicationDelegate, WebSocketDelegate {
  var statusBarItem: NSStatusItem!
  var menuItem: NSMenuItem!
  var observer: AXObserver?
  var oldWindow: AXUIElement?
  var socket: WebSocket!
  var oldMenu: NetworkMessageThing?
  var idle = false
  var isConnected = false

  func windowTitleChanged(
    _ axObserver: AXObserver,
    axElement: AXUIElement,
    notification: CFString
  ) {

    let frontmost = NSWorkspace.shared.frontmostApplication!
    var z: AnyObject?
    AXUIElementCopyAttributeValue(axElement, kAXTitleAttribute as CFString, &z)

    var newTitle = NetworkMessageThing(app: frontmost.localizedName!, title: z as? String ?? "")

    menuItem.title = newTitle.app + ";" + newTitle.title

    if frontmost.localizedName == "Google Chrome" {
      let chromeObject: ChromeThing = SBApplication.init(bundleIdentifier: "com.google.Chrome")!

      let f = chromeObject.windows!()[0]
      let t = f.activeTab!

      if f.mode == "incognito" {
        newTitle = NetworkMessageThing(app: "", title: "")
      } else {
        newTitle.url = t.URL
        if let title = t.title { newTitle.title = title }
      }
    }

    self.sendMessage(message: newTitle)
    oldMenu = newTitle
  }

  func sendMessage(message: NetworkMessageThing) {
    guard isConnected else { return }
    let jsonEncoder = JSONEncoder()
    let jsonData = try! jsonEncoder.encode(message)
    guard let json = String(data: jsonData, encoding: String.Encoding.utf8) else { return }
    print(json)
    socket.write(string: json)
  }
  @objc private func focusedWindowChanged(_ observer: AXObserver, window: AXUIElement) {
    if oldWindow != nil {
      AXObserverRemoveNotification(
        observer, oldWindow!, kAXFocusedWindowChangedNotification as CFString)
    }

    let selfPtr = UnsafeMutableRawPointer(Unmanaged.passUnretained(self).toOpaque())
    AXObserverAddNotification(observer, window, kAXTitleChangedNotification as CFString, selfPtr)

    windowTitleChanged(
      observer, axElement: window, notification: kAXTitleChangedNotification as CFString)

    oldWindow = window
  }

  @objc private func focusedAppChanged() {
    if observer != nil {
      CFRunLoopRemoveSource(
        RunLoop.current.getCFRunLoop(),
        AXObserverGetRunLoopSource(observer!),
        CFRunLoopMode.defaultMode)
    }

    let frontmost = NSWorkspace.shared.frontmostApplication!
    let pid = frontmost.processIdentifier
    let x = AXUIElementCreateApplication(pid)

    AXObserverCreate(
      pid,
      {
        (
          _ axObserver: AXObserver,
          axElement: AXUIElement,
          notification: CFString,
          userData: UnsafeMutableRawPointer?
        ) -> Void in
        guard let userData = userData else {
          print("Missing userData")
          return
        }
        let application = Unmanaged<AppDelegate>.fromOpaque(userData).takeUnretainedValue()
        if notification == kAXFocusedWindowChangedNotification as CFString {
          application.focusedWindowChanged(axObserver, window: axElement)
        } else {
          application.windowTitleChanged(
            axObserver, axElement: axElement, notification: notification)
        }
      }, &observer)

    let selfPtr = UnsafeMutableRawPointer(Unmanaged.passUnretained(self).toOpaque())
    AXObserverAddNotification(
      observer!, x, kAXFocusedWindowChangedNotification as CFString, selfPtr)

    CFRunLoopAddSource(
      RunLoop.current.getCFRunLoop(),
      AXObserverGetRunLoopSource(observer!),
      CFRunLoopMode.defaultMode)

    var focusedWindow: AnyObject?
    AXUIElementCopyAttributeValue(x, kAXFocusedWindowAttribute as CFString, &focusedWindow)

    if focusedWindow != nil {
      focusedWindowChanged(observer!, window: focusedWindow as! AXUIElement)
    }
  }

  func didReceive(event: WebSocketEvent, client: WebSocket) {
    switch event {
    case .connected(let headers):
      print("websocket is connected: \(headers)")
      self.isConnected = true
      socket.write(string: "HI")
    case .disconnected(_, _):
      print("websocket is disconnected")
      DispatchQueue.global().asyncAfter(deadline: .now() + 1) {
        print("reconnecting")
        self.isConnected = false
        self.reconnect()
      }
    case .text(let string):
      print("Received text: \(string)")
    case .binary(let data):
      print("Received data: \(data.count)")
    default:
      break
    }
  }

  func reconnect() {
    if isConnected { return }

    let request = URLRequest(url: URL(string: "ws://localhost:8080")!, timeoutInterval: 5)
    self.socket = WebSocket(request: request)
    self.socket.delegate = self
    self.socket.connect()
    isConnected = false
    DispatchQueue.global().asyncAfter(deadline: .now() + 1.0) {
      self.reconnect()
    }
  }

  func applicationDidFinishLaunching(_ aNotification: Notification) {
    statusBarItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)

    statusBarItem.button?.title = "👁"

    let statusBarMenu = NSMenu(title: "TimeViewer Status Bar Menu")
    statusBarMenu.autoenablesItems = false
    statusBarItem.menu = statusBarMenu

    menuItem = statusBarMenu.addItem(
      withTitle: "TimeViewer;Magic", action: nil,
      keyEquivalent: "")
    menuItem.isEnabled = false

    statusBarMenu.addItem(
      withTitle: "Quit",
      action: #selector(AppDelegate.quit),
      keyEquivalent: "")

    self.reconnect()

    NSWorkspace.shared.notificationCenter.addObserver(
      self, selector: #selector(self.focusedAppChanged),
      name: NSWorkspace.didActivateApplicationNotification,
      object: nil)
    self.focusedAppChanged()
    self.detectIdle()
  }

  func detectIdle() {
    let seconds = 15.0 - SystemIdleTime()!
    if seconds < 0.0 {
      self.sendMessage(message: NetworkMessageThing(app: "", title: ""))

      var monitor: Any?
      monitor = NSEvent.addGlobalMonitorForEvents(matching: [
        .mouseMoved, .leftMouseDown, .rightMouseDown, .keyDown,
      ]) { e in
        NSEvent.removeMonitor(monitor!)
        if let oldMenu = self.oldMenu { self.sendMessage(message: oldMenu) }
        self.detectIdle()
      }

      return
    }

    DispatchQueue.main.asyncAfter(deadline: .now() + seconds) {
      self.detectIdle()
    }
  }

  @objc func quit() {
    NSApplication.shared.terminate(self)
  }
}
