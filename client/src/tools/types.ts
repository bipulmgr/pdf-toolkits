export type OptionType =
  | 'text' | 'number' | 'select' | 'checkbox' | 'color' | 'password' | 'textarea' | 'range';

export interface ToolOption {
  key: string;
  label: string;
  type: OptionType;
  default?: string | number | boolean;
  choices?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  help?: string;
  /** Only show when another option has one of these values. */
  showIf?: { key: string; values: (string | boolean)[] };
}

export interface ToolOutput {
  name: string;
  blob: Blob;
}

export interface RunResult {
  outputs: ToolOutput[];
  /** Optional HTML shown under the result (e.g. a comparison report). */
  reportHtml?: string;
  message?: string;
}

export interface ToolContext {
  files: File[];
  opts: Record<string, any>;
  /** Data produced by a tool's interactive editor. */
  editorState: any;
  progress: (message: string, fraction?: number) => void;
}

export interface EditorApi {
  /** Value handed to run() as ctx.editorState. */
  getState: () => any;
  destroy?: () => void;
}

export interface Tool {
  id: string;
  name: string;
  category: string;
  description: string;
  icon: string; // short label shown in the tile
  color: string;
  accept: string;
  multiple?: boolean;
  minFiles?: number;
  maxFiles?: number;
  /** Extra hint shown under the drop zone. */
  note?: string;
  actionLabel: string;
  options?: ToolOption[];
  /** Builds an interactive UI once files are selected. */
  editor?: (host: HTMLElement, files: File[]) => Promise<EditorApi>;
  run: (ctx: ToolContext) => Promise<RunResult>;
}
