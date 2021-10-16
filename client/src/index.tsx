import { render } from "solid-js/web";
import { batch, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import "./style.css";

type TimeThing = {
  starttime: string;
  endtime?: string;
  app: string;
  url?: string;
  title: string;
};

function hashcode(str: string): number {
  let hash = 0;
  if (str.length === 0) {
    return hash;
  }
  for (let i = 0; i < str.length; i++) {
    const character = str.charCodeAt(i);
    hash = (hash << 5) - hash + character;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash;
}

const millistoduration = (millis: number): string => {
  if (millis < 1000) {
    return "<1s";
  }
  if (millis < 1000 * 60 * 60) {
    if (Math.floor(millis / (1000 * 60)) > 0) return Math.floor(millis / (1000 * 60)) + "m " + Math.round((millis % (1000 * 60)) / 1000) + "s";
    else return Math.round((millis % (1000 * 60)) / 1000) + "s";
  }
  return Math.floor(millis / (1000 * 60 * 60)) + "h " + Math.round((millis % (1000 * 60 * 60)) / (1000 * 60)) + "m";
};
const Counter = () => {
  let [timeList, setTimeList] = createSignal<TimeThing[]>([], {
    equals: false,
  });

  const ws = new WebSocket("ws://localhost:8080");
  ws.onopen = () => {
    ws.send("client");
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data) as TimeThing | TimeThing[];
    if (Array.isArray(m)) {
      setTimeList(m);
    } else {
      let current = timeList().slice();
      current[current.length - 1].endtime = m.starttime;
      if (m.app != "") current.push(m);
      setTimeList(current);
    }
  };

  const startOfDay = new Date().setHours(8, 0, 0, 0);

  const [currentMillis, setCurrentMillis] = createSignal(Date.now());
  let animationFrame: number;
  const animate = () => {
    setCurrentMillis(Date.now());
    animationFrame = requestAnimationFrame(animate);
  };
  animate();
  onCleanup(() => window.cancelAnimationFrame(animationFrame));

  const [slowMillis, setSlowMillis] = createSignal(Date.now());
  const interval = setInterval(() => setSlowMillis(Date.now()), 1000);
  onCleanup(() => window.clearInterval(interval));

  const svgWidth = 700;

  const [translate, setTranslate] = createSignal(svgWidth / 2);
  const [zoom, setZoom] = createSignal(1);

  const ticks = () => {
    return [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23].map((x) => new Date().setHours(x, 0, 0, 0));
  };

  let sitess = createMemo<{
    [site: string]: {
      site: string;
      time: () => number;
      setTime: (n: number) => void;
      add: number;
    };
  }>((sites) => {
    for (const site in sites) sites[site].add = 0;
    for (const s of timeList()) {
      if (!s.url) continue;

      let url = new URL(s.url).hostname;
      if (!sites[url]) {
        let [time, setTime] = createSignal(0);
        sites[url] = { site: url, time, setTime, add: 0 };
      }

      if (!s.endtime) continue;
      sites[url].add += new Date(s.endtime).getTime() - new Date(s.starttime).getTime();
    }
    batch(() => {
      for (const site in sites) sites[site].setTime(sites[site].add);
    });

    return sites;
  }, {});

  let obj = () => {
    const sites = sitess();

    let s = timeList()[timeList().length - 1];
    if (s && s.url) {
      let url = new URL(s.url).hostname;

      sites[url].setTime(sites[url].add + (s.endtime ? new Date(s.endtime).getTime() : slowMillis()) - new Date(s.starttime).getTime());
    }
    return Object.values(sites).sort((a, b) => b.time() - a.time());
  };

  let appss = createMemo<{
    [app: string]: {
      app: string;
      time: () => number;
      setTime: (n: number) => void;
      add: number;
    };
  }>((apps) => {
    for (const app in apps) apps[app].add = 0;
    for (const s of timeList()) {
      if (!s.app) continue;

      if (!apps[s.app]) {
        let [time, setTime] = createSignal(0);
        apps[s.app] = { app: s.app, time, setTime, add: 0 };
      }

      if (!s.endtime) continue;
      apps[s.app].add += new Date(s.endtime).getTime() - new Date(s.starttime).getTime();
    }
    batch(() => {
      for (const app in apps) apps[app].setTime(apps[app].add);
    });
    return apps;
  }, {});

  let appObj = () => {
    const apps = appss();

    let s = timeList()[timeList().length - 1];
    if (s && s.app) {
      apps[s.app].setTime(apps[s.app].add + (s.endtime ? new Date(s.endtime).getTime() : slowMillis()) - new Date(s.starttime).getTime());
    }
    return Object.values(apps).sort((a, b) => b.time() - a.time());
  };

  return (
    <>
      <svg
        width={svgWidth}
        height="130"
        onWheel={(e) => {
          if (e.ctrlKey) {
            let oldZoom = zoom();
            let newZoom = Math.max(Math.min(oldZoom * Math.pow(2, e.deltaY * -0.1), 10 * 60), 1);
            setTranslate((newZoom / oldZoom) * (translate() - e.offsetX) + e.offsetX);
            setZoom(newZoom);
          } else {
            setTranslate(translate() - e.deltaX);
          }
          e.preventDefault();
        }}
      >
        <g transform={`translate(${Math.round((((startOfDay - currentMillis()) * svgWidth * zoom()) / (1000 * 60 * 60) + translate()) * 10) / 10},0)`}>
          <g>
            <For each={timeList()}>
              {(el) => {
                const round = (x: number) => Math.round(x * 10) / 10;
                const transform = (x: number) => (x * svgWidth * zoom()) / (1000 * 60 * 60);

                let startPos = () => round(transform(new Date(el.starttime).getTime() - startOfDay));

                let width = () => round(transform((el.endtime ? new Date(el.endtime).getTime() : currentMillis()) - new Date(el.starttime).getTime()));
                let fill = `hsl(${hashcode(el.title) % 360},100%,80%)`;
                let border = `hsl(${hashcode(el.app) % 360},100%,40%)`;

                return (
                  <Show when={!el.endtime || transform(new Date(el.endtime).getTime() - currentMillis() + 1000 * 60 * 60) + translate() > 0}>
                    <g transform={`translate(${startPos()},0)`}>
                      <rect fill={fill} stroke={border} stroke-width="1" width={width()} height="90" rx="0" />
                      <foreignObject x="0" y="0" width={width()} height="90">
                        <div style="width:100%; height:100%; color: black; white-space: nowrap; pointer-events: none; overflow: hidden;">
                          <div style="text-overflow: ellipsis; overflow: hidden; font-size: 35px">{el.app}</div>
                          <div style="text-overflow: ellipsis; overflow: hidden; font-size: 15px">{el.title}</div>
                        </div>
                      </foreignObject>
                    </g>
                  </Show>
                );
              }}
            </For>
          </g>
          <g>
            <For each={ticks()}>
              {(t) => (
                <>
                  <rect fill="#fff" height="30" width="1" x={((t - startOfDay) * svgWidth * zoom()) / (1000 * 60 * 60)} y={100}></rect>
                  <text fill="#eee" x={((t - startOfDay) * svgWidth * zoom()) / (1000 * 60 * 60) + 2} y={120}>
                    {new Date(t).toLocaleTimeString()}
                  </text>
                </>
              )}
            </For>
          </g>
        </g>
        <path d={`M0,100H${svgWidth}`} stroke="#fff" />
      </svg>
      <table>
        <colgroup>
          <col style="width:80px" />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th colSpan="2">Websites</th>
          </tr>
        </thead>
        <tbody>
          <For each={obj()}>
            {(y) => (
              <tr>
                <td>{millistoduration(y.time())}</td>
                <td>{y.site}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
      <table>
        <colgroup>
          <col style="width:80px" />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th colSpan="2">Apps</th>
          </tr>
        </thead>
        <tbody>
          <For each={appObj()}>
            {(y) => (
              <tr>
                <td>{millistoduration(y.time())}</td>
                <td>{y.app}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </>
  );
};

const App = () => {
  return <Counter />;
};

render(() => <App />, document.getElementById("root")!);
