import { createGlobalStyles, css } from "solid-styled-components";
import { render } from "solid-js/web";
import { ParentComponent, createSignal } from "solid-js";
import { Graph } from "./graph";
import { A, Route, Router } from "@solidjs/router";
import { Table } from "./table";

import { type TimeThing, TimeListContext } from "./timelist";

const bg = "rgb(0 30 61)";
const Styles = createGlobalStyles`
  body {
    margin: 0;
    padding: 0;
    background-color: ${bg};
  }
`;

const appStyles = css({
  color: "#eee",
  fontFamily: "-apple-system, BlinkMacSystemFont",
  position: "relative",
});

const mainStyles = css({
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  padding: "2rem",
  maxWidth: "702px",
  margin: "0 auto",
});

const navStyles = css({
  backgroundColor: "rgb(7 27 46)",
  position: "sticky",
  top: 0,
  height: "4rem",
  borderBottom: "1px solid #eee",
  display: "flex",
  alignItems: "center",
  paddingLeft: "1em",
  a: {
    textDecoration: "none",
    color: "#fff",
    lineHeight: "3em",
    height: "3em",
    padding: "0 1rem",
    borderRadius: "8px",
    "&:hover": {
      background: "rgba(19, 47, 76, 0.4)",
    },
  },
});

const logoStyles = css({
  fontSize: "3em",
  width: "4rem",
  height: "4rem",
  marginRight: "0.5rem",
  verticalAlign: "middle",
});

const App: ParentComponent = (props) => {
  let [timeList, setTimeList] = createSignal<TimeThing[]>([]);

  let ws: WebSocket;
  const setup = () => {
    ws = new WebSocket(`ws://${location.host}/client`);
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data, (key, value) => {
        if (key === "starttime" || (key === "endtime" && value != undefined)) {
          return new Date(value);
        }
        return value;
      }) as TimeThing | TimeThing[];
      if (Array.isArray(m)) {
        setTimeList(m);
      } else {
        let current = timeList().slice();
        current[current.length - 1].endtime = m.starttime;
        if (m.app != "") current.push(m);
        setTimeList(current);
      }
    };
    ws.onclose = () => {
      setTimeout(setup, 1000);
    };
  };
  setup();

  return (
    <div class={appStyles}>
      <Styles />
      <nav class={navStyles}>
        <A href="/">
          <span class={logoStyles}>👁</span>TimeViewer
        </A>
        <A href="/graph">Graph</A>
      </nav>
      <div class={mainStyles}>
        <TimeListContext.Provider value={timeList}>
          {props.children}
        </TimeListContext.Provider>
      </div>
    </div>
  );
};

render(
  () => (
    <Router root={App}>
      <Route path="/graph" component={Graph} />
      <Route path="/" component={Table} />
    </Router>
  ),
  document.getElementById("root")!,
);
