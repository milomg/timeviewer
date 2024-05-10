import {
  batch,
  Component,
  createMemo,
  createSignal,
  For,
  onCleanup,
  useContext,
} from "solid-js";
import { css } from "solid-styled-components";
import { TimeListContext, TimeThing } from "./timelist";

const millistoduration = (millis: number): string => {
  if (millis < 1000) {
    return "<1s";
  }
  if (millis < 1000 * 60 * 60) {
    if (Math.floor(millis / (1000 * 60)) > 0)
      return (
        Math.floor(millis / (1000 * 60)) +
        "m " +
        Math.round((millis % (1000 * 60)) / 1000) +
        "s"
      );
    else return Math.round((millis % (1000 * 60)) / 1000) + "s";
  }
  return (
    Math.floor(millis / (1000 * 60 * 60)) +
    "h " +
    Math.round((millis % (1000 * 60 * 60)) / (1000 * 60)) +
    "m"
  );
};

const tableStyles = css({
  width: "700px",
  overflowX: "scroll",
  textAlign: "left",
});

const tableGroupStyles = css({
  gap: "2rem",
  display: "flex",
  flexDirection: "column",
});

export const Table: Component = () => {
  const timeList = useContext(TimeListContext);
  const [slowMillis, setSlowMillis] = createSignal(Date.now());
  const interval = setInterval(() => setSlowMillis(Date.now()), 1000);
  onCleanup(() => window.clearInterval(interval));

  let reduceToObject = (mapper: (x: TimeThing) => string | undefined) => {
    const initialMemo = createMemo<{
      [site: string]: {
        mapped: string;
        time: () => number;
        setTime: (n: number) => void;
        add: number;
      };
    }>((obj) => {
      for (const item in obj) obj[item].add = 0;
      for (const s of timeList()) {
        const mapped = mapper(s);
        if (!mapped) continue;
        if (!obj[mapped]) {
          const [time, setTime] = createSignal(0);
          obj[mapped] = { mapped, time, setTime, add: 0 };
        }
        if (!s.endtime) continue;
        obj[mapped].add += s.endtime - s.starttime;
      }
      batch(() => {
        for (const site in obj) obj[site].setTime(obj[site].add);
      });

      return obj;
    }, {});

    return () => {
      const sites = initialMemo();

      const s = timeList()[timeList().length - 1];
      if (s) {
        const url = mapper(s);
        if (url)
          sites[url].setTime(
            sites[url].add +
              (s.endtime ? s.endtime : slowMillis()) -
              s.starttime,
          );
      }
      return Object.values(sites).sort((a, b) => b.time() - a.time());
    };
  };

  const websiteObj = reduceToObject(
    (s) => s && s.url && new URL(s.url).hostname,
  );
  const appObj = reduceToObject((s) => s && s.app);

  let currentName = () => {
    let current = timeList()[timeList().length - 1];
    return (
      current &&
      (current.url ? new URL(current.url).hostname : current.app || "Idle")
    );
  };

  return (
    <>
      <h1>You are going to be productive today</h1>
      <p>You are currently on: {currentName()}</p>
      <div class={tableGroupStyles}>
        <table class={tableStyles}>
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
            <For each={websiteObj()}>
              {(y) => (
                <tr>
                  <td>{millistoduration(y.time())}</td>
                  <td>{y.mapped}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
        <table class={tableStyles}>
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
                  <td>{y.mapped}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </>
  );
};
