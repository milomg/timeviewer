import { createContext } from "solid-js";

export type TimeThing = {
  starttime: Date;
  endtime?: Date;
  app: string;
  url?: string;
  title: string;
};

export const TimeListContext = createContext<() => TimeThing[]>(() => []);
