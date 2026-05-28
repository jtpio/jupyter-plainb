import {
  parsePy,
  parseSphinxGallery,
  parseClassicMd,
  parseMystMd,
  toPy,
  toSphinxGallery,
  toClassicMd,
  toMystMd
} from 'plainb';
import type { Notebook } from 'plainb';

export type ParserName =
  | 'parsePy'
  | 'parseSphinxGallery'
  | 'parseClassicMd'
  | 'parseMystMd';

export interface IRule {
  dir: string;
  parser: ParserName;
}

export interface IKernelspec {
  name: string;
  display_name: string;
  language: string;
}

export interface IPlainTextNotebookConfig {
  rules?: IRule[];
  defaultKernelspec?: IKernelspec;
}

export const PARSERS: Record<ParserName, (text: string) => object> = {
  parsePy,
  parseSphinxGallery,
  parseClassicMd,
  parseMystMd
};

export const SERIALIZERS: Record<ParserName, (notebook: Notebook) => string> = {
  parsePy: toPy,
  parseSphinxGallery: toSphinxGallery,
  parseClassicMd: toClassicMd,
  parseMystMd: toMystMd
};

export const PARSER_LABELS: Record<ParserName, string> = {
  parsePy: 'Percent format (.py)',
  parseSphinxGallery: 'Sphinx Gallery (.py)',
  parseClassicMd: 'Classic Markdown (.md)',
  parseMystMd: 'MyST Notebook (.md)'
};

export const PARSER_EXTENSIONS: Record<ParserName, string[]> = {
  parsePy: ['.py'],
  parseSphinxGallery: ['.py'],
  parseClassicMd: ['.md'],
  parseMystMd: ['.md']
};

export const CONTEXT_MENU_LABELS: Record<ParserName, string> = {
  parsePy: 'Notebook (Percent .py)',
  parseSphinxGallery: 'Notebook (Sphinx Gallery .py)',
  parseClassicMd: 'Notebook (Classic Markdown .md)',
  parseMystMd: 'Notebook (MyST .md)'
};
