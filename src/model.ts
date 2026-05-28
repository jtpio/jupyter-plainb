import { NotebookModel, NotebookModelFactory } from '@jupyterlab/notebook';
import { DocumentRegistry } from '@jupyterlab/docregistry';
import { Contents, KernelSpec } from '@jupyterlab/services';
import type { ISharedNotebook } from '@jupyter/ydoc';
import type { Notebook } from 'plainb';
import {
  DEFAULT_KERNELSPEC,
  extractKernelspecFromText,
  kernelspecFromLanguage
} from './convert';

/**
 * A custom NotebookModel that parses and serializes from/to plain text.
 */
export class PlainTextNotebookModel extends NotebookModel {
  constructor(
    options: NotebookModel.IOptions & {
      parser: (text: string) => object;
      serializer: (notebook: Notebook) => string;
      specs?: KernelSpec.ISpecModels | null;
    }
  ) {
    super(options);
    this._parser = options.parser;
    this._serializer = options.serializer;
    this._specs = options.specs ?? null;
  }

  toString(): string {
    const json = super.toJSON() as any;

    // Normalize cell sources to string[]
    if (json.cells) {
      for (const cell of json.cells) {
        if (typeof cell.source === 'string') {
          // Split into lines preserving trailing \n on each line
          const lines = cell.source.split('\n');
          cell.source = lines.map((line: string, i: number) =>
            i < lines.length - 1 ? line + '\n' : line
          );
          // Remove a trailing empty string produced if source ends with \n
          if (
            cell.source.length > 1 &&
            cell.source[cell.source.length - 1] === ''
          ) {
            cell.source.pop();
          }
        }
      }
    }

    return this._serializer(json as unknown as Notebook);
  }

  fromString(value: string): void {
    const notebook = this._parser(value) as any;

    // Ensure kernelspec is set
    if (!notebook.metadata?.kernelspec) {
      notebook.metadata = notebook.metadata ?? {};
      const language = notebook.metadata?.language_info?.name || 'python';
      const kernelspec =
        extractKernelspecFromText(value) ??
        kernelspecFromLanguage(this._specs, language) ??
        (language.toLowerCase() === 'python' ? DEFAULT_KERNELSPEC : undefined);
      if (kernelspec) {
        notebook.metadata.kernelspec = kernelspec;
        if (!notebook.metadata.language_info) {
          notebook.metadata.language_info = { name: kernelspec.language };
        }
      } else {
        if (!notebook.metadata.language_info) {
          notebook.metadata.language_info = { name: language };
        }
      }
    }

    super.fromJSON(notebook);
  }

  private _parser: (text: string) => object;
  private _serializer: (notebook: Notebook) => string;
  private _specs: KernelSpec.ISpecModels | null;
}

/**
 * A custom NotebookModelFactory that tells the DocumentRegistry to load the file as plain text.
 */
export class PlainTextNotebookModelFactory extends NotebookModelFactory {
  constructor(
    options: NotebookModelFactory.IOptions & {
      name: string;
      parser: (text: string) => object;
      serializer: (notebook: Notebook) => string;
      specs?: KernelSpec.ISpecModels | null;
    }
  ) {
    super(options);
    this._name = options.name;
    this._parser = options.parser;
    this._serializer = options.serializer;
    this._specs = options.specs ?? null;
  }

  get name(): string {
    return this._name;
  }

  get contentType(): Contents.ContentType {
    return 'file';
  }

  get fileFormat(): Contents.FileFormat {
    return 'text';
  }

  createNew(
    options?: DocumentRegistry.IModelOptions<ISharedNotebook>
  ): PlainTextNotebookModel {
    return new PlainTextNotebookModel({
      ...options,
      parser: this._parser,
      serializer: this._serializer,
      specs: this._specs
    });
  }

  private _name: string;
  private _parser: (text: string) => object;
  private _serializer: (notebook: Notebook) => string;
  private _specs: KernelSpec.ISpecModels | null;
}
