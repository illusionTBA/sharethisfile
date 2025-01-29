import { c } from "tasai";

export const log = {
  info: (...args: any[]) => console.log(c.blue("[INFO]"), ...args),
  error: (...args: any[]) => console.log(c.red("[ERROR]"), ...args),
  warn: (...args: any[]) => console.log(c.yellow("[WARN]"), ...args),
  debug: (...args: any[]) => console.log(c.magenta("[DEBUG]"), ...args),
};
