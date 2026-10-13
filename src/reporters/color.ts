export interface Colors {
  green(text: string): string;
  red(text: string): string;
  yellow(text: string): string;
  gray(text: string): string;
  bold(text: string): string;
}

const wrap = (open: number, close: number) => (text: string) => `\u001b[${open}m${text}\u001b[${close}m`;

const ANSI: Colors = {
  green: wrap(32, 39),
  red: wrap(31, 39),
  yellow: wrap(33, 39),
  gray: wrap(90, 39),
  bold: wrap(1, 22),
};

const identity = (text: string): string => text;
const PLAIN: Colors = { green: identity, red: identity, yellow: identity, gray: identity, bold: identity };

/** Colors only for TTYs, honoring NO_COLOR / FORCE_COLOR and --no-color. */
export function createColors(options: { isTTY: boolean; noColor?: boolean; env?: NodeJS.ProcessEnv }): Colors {
  const env = options.env ?? process.env;
  if (options.noColor || (env.NO_COLOR !== undefined && env.NO_COLOR !== '')) return PLAIN;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '0') return ANSI;
  return options.isTTY ? ANSI : PLAIN;
}

export const plainColors = PLAIN;
