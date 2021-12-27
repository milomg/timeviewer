import {
  batch,
  Component,
  createMemo,
  createSignal,
  For,
  onCleanup,
} from "solid-js";
import { css } from "solid-styled-components";
import type { TimeThing } from "./types";

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

export const Table: Component<{ timelist: TimeThing[] }> = (props) => {
  const [slowMillis, setSlowMillis] = createSignal(Date.now());
  const interval = setInterval(() => setSlowMillis(Date.now()), 1000);
  onCleanup(() => window.clearInterval(interval));

  let reduceToObject = (mapper: (x: TimeThing) => string | undefined) => {
    let initialMemo = createMemo<{
      [site: string]: {
        mapped: string;
        time: () => number;
        setTime: (n: number) => void;
        add: number;
      };
    }>((obj) => {
      for (const item in obj) obj[item].add = 0;
      for (const s of props.timelist) {
        let mapped = mapper(s);
        if (!mapped) continue;
        if (!obj[mapped]) {
          let [time, setTime] = createSignal(0);
          obj[mapped] = { mapped, time, setTime, add: 0 };
        }
        if (!s.endtime) continue;
        obj[mapped].add +=
          new Date(s.endtime).getTime() - new Date(s.starttime).getTime();
      }
      batch(() => {
        for (const site in obj) obj[site].setTime(obj[site].add);
      });

      return obj;
    }, {});

    return () => {
      const sites = initialMemo();

      let s = props.timelist[props.timelist.length - 1];
      if (s) {
        let url = mapper(s);
        if (url)
          sites[url].setTime(
            sites[url].add +
              (s.endtime ? new Date(s.endtime).getTime() : slowMillis()) -
              new Date(s.starttime).getTime()
          );
      }
      return Object.values(sites).sort((a, b) => b.time() - a.time());
    };
  };

  let obj = reduceToObject((s) => s && s.url && new URL(s.url).hostname);

  let appObj = reduceToObject((s) => s && s.app);

  return (
    <>
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
          <For each={obj()}>
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
    </>
  );
};
