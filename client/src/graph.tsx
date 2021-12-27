import { Component, createSignal, For, onCleanup, Show } from "solid-js";
import { css } from "solid-styled-components";
import type { TimeThing } from "./types";

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

const graphStyles = css({
  border: "1px solid #eee",
  borderRadius: "4px",
  display: "block",
});

const svgWidth = 700;
export const Graph: Component<{ timelist: TimeThing[] }> = (props) => {
  const [translate, setTranslate] = createSignal(svgWidth / 2);
  const [zoom, setZoom] = createSignal(1);

  const ticks = () => {
    return [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23].map(
      (x) => new Date().setHours(x, 0, 0, 0)
    );
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

  return (
    <svg
      width={svgWidth}
      height="130"
      class={graphStyles}
      onWheel={(e) => {
        if (e.ctrlKey) {
          let oldZoom = zoom();
          let newZoom = Math.max(
            Math.min(oldZoom * Math.pow(2, e.deltaY * -0.1), 10 * 60),
            1
          );
          setTranslate(
            (newZoom / oldZoom) * (translate() - e.offsetX) + e.offsetX
          );
          setZoom(newZoom);
        } else {
          setTranslate(translate() - e.deltaX);
        }
        e.preventDefault();
      }}
    >
      <g
        transform={`translate(${
          Math.round(
            (((startOfDay - currentMillis()) * svgWidth * zoom()) /
              (1000 * 60 * 60) +
              translate()) *
              10
          ) / 10
        },0)`}
      >
        <g>
          <For each={props.timelist}>
            {(el) => {
              const round = (x: number) => Math.round(x * 10) / 10;
              const transform = (x: number) =>
                (x * svgWidth * zoom()) / (1000 * 60 * 60);

              let startPos = () =>
                round(transform(new Date(el.starttime).getTime() - startOfDay));

              let width = () =>
                round(
                  transform(
                    (el.endtime
                      ? new Date(el.endtime).getTime()
                      : currentMillis()) - new Date(el.starttime).getTime()
                  )
                );
              let fill = `hsl(${hashcode(el.title) % 360},100%,80%)`;
              let border = `hsl(${hashcode(el.app) % 360},100%,40%)`;

              return (
                <Show
                  when={
                    !el.endtime ||
                    transform(
                      new Date(el.endtime).getTime() -
                        currentMillis() +
                        1000 * 60 * 60
                    ) +
                      translate() >
                      0
                  }
                >
                  <g transform={`translate(${startPos()},0)`}>
                    <rect fill={fill} width={width()} height="80" />
                    <rect fill={border} width={width()} height="10" y={80} />
                    <foreignObject x="0" y="0" width={width()} height="90">
                      <div style="width:100%; height:100%; color: black; white-space: nowrap; pointer-events: none; overflow: hidden;">
                        <div style="text-overflow: ellipsis; overflow: hidden; font-size: 35px">
                          {el.app}
                        </div>
                        <div style="text-overflow: ellipsis; overflow: hidden; font-size: 15px">
                          {el.title}
                        </div>
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
                <rect
                  fill="#fff"
                  height="30"
                  width="1"
                  x={((t - startOfDay) * svgWidth * zoom()) / (1000 * 60 * 60)}
                  y={100}
                ></rect>
                <text
                  fill="#eee"
                  x={
                    ((t - startOfDay) * svgWidth * zoom()) / (1000 * 60 * 60) +
                    2
                  }
                  y={120}
                >
                  {new Date(t).toLocaleTimeString()}
                </text>
              </>
            )}
          </For>
        </g>
      </g>
      <path d={`M0,100H${svgWidth}`} stroke="#fff" />
    </svg>
  );
};
