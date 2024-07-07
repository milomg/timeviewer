# TimeViewer

A "simple" app to track your time

![TimeViewer demo view](README.png)


## Full Setup

* `sqlx database create; sqlx migrate run`
* `cd client; pnpm i; pnpm run build`

* `touch ~/Library/LaunchAgents/com.timeviewer.main.plist`

```
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.timeviewer.main</string>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/sh</string>
        <string>-c</string>
        <string>cd ~/PATH TO TIMEVIEWER REPLACE HERE/server; exec ~/.cargo/bin/cargo run --release</string>
    </array>

    <key>OnDemand</key>
    <false/>

    <key>StartInterval</key>
    <integer>60</integer>

    <key>StandardErrorPath</key>
    <string>/tmp/Timeviewer.err</string>

    <key>StandardOutPath</key>
    <string>/tmp/Timeviewer.out</string>
</dict>
</plist>
```
* `launchctl load -w ~/Library/LaunchAgents/com.timeviewer.main.plist`

## Development Setup
* `cd server; cargo run`
* `cd client; pnpm i; pnpm run start`
* `open monitor/TimeViewer.xcodeproj` and build and run
