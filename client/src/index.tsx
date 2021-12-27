import { createGlobalStyles, css } from "solid-styled-components";
import { render } from "solid-js/web";
import { createSignal } from "solid-js";
import { Graph } from "./graph";
import { Table } from "./table";
import type { TimeThing } from "./types";

const Styles = createGlobalStyles`
  body {
    margin: 0;
    padding: 0;
  }
`;

const appStyles = css({
  backgroundColor: "rgb(34, 35, 39)",
  color: "#eee",
  fontFamily: "-apple-system, BlinkMacSystemFont",
  position: "relative",
});

const mainStyles = css({
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  padding: "2rem",
  gap: "2rem",
  maxWidth: "702px",
  margin: "0 auto",
});

const navStyles = css({
  backgroundColor: "rgb(34, 35, 39)",
  position: "sticky",
  width: "100%",
  top: 0,
  height: "4rem",
  borderBottom: "1px solid #eee",
  display: "flex",
  alignItems: "center",
});

const logoStyles = css({
  fontSize: "3em",
  width: "4rem",
  height: "4rem",
  margin: "0 0.5rem",
});

const App = () => {
  let [timeList, setTimeList] = createSignal<TimeThing[]>([]);

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

  return (
    <div class={appStyles}>
      <nav class={navStyles}>
        <div class={logoStyles}>👁</div>
        <div>TimeViewer</div>
      </nav>
      <div class={mainStyles}>
        <Styles />
        <Graph timelist={timeList()} />
        <Table timelist={timeList()} />
      </div>
    </div>
  );
};

render(() => <App />, document.getElementById("root")!);
