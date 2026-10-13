export interface OutputStream {
  write(text: string): unknown;
  isTTY?: boolean;
}

export interface CliIO {
  stdout: OutputStream;
  stderr: OutputStream;
  cwd: string;
  env: NodeJS.ProcessEnv;
}
