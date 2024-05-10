import { createContext } from "solid-js";

export type TimeThing = {
  starttime: number;
  endtime?: number;
  app: string;
  url?: string;
  title: string;
};

export const TimeListContext = createContext<() => TimeThing[]>(() => []);
