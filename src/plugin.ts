import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { DocumentRegistry } from '@jupyterlab/docregistry';
import {
  showDialog,
  Dialog,
  createToolbarFactory,
  IToolbarWidgetRegistry
} from '@jupyterlab/apputils';
import { IFileBrowserFactory } from '@jupyterlab/filebrowser';
import { PageConfig } from '@jupyterlab/coreutils';
import { MenuSvg, notebookIcon } from '@jupyterlab/ui-components';
import {
  PARSERS,
  PARSER_LABELS,
  PARSER_EXTENSIONS,
  SERIALIZERS
} from './parsers';
import type {
  ParserName,
  IPlainTextNotebookConfig,
  IKernelspec
} from './parsers';
import {
  convertFile,
  convertFileAuto,
  convertNotebookToPlainText,
  autoConvert
} from './convert';
import {
  INotebookTracker,
  NotebookPanel,
  NotebookTracker,
  NotebookWidgetFactory
} from '@jupyterlab/notebook';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { IEditorServices } from '@jupyterlab/codeeditor';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';
import { PlainTextNotebookModelFactory } from './model';

/**
 * Setting ID for the notebook panel toolbar configuration.
 * We reuse the standard notebook toolbar settings so our panels
 * get the exact same toolbar items.
 */
const PANEL_SETTINGS = '@jupyterlab/notebook-extension:panel';

export const plugin: JupyterFrontEndPlugin<void> = {
  id: 'ptjnb:plugin',
  autoStart: true,
  requires: [
    IFileBrowserFactory,
    IRenderMimeRegistry,
    NotebookPanel.IContentFactory,
    IEditorServices,
    IToolbarWidgetRegistry
  ],
  optional: [INotebookTracker, ISettingRegistry, ITranslator],
  activate: async (
    app: JupyterFrontEnd,
    browserFactory: IFileBrowserFactory,
    rendermime: IRenderMimeRegistry,
    contentFactory: NotebookPanel.IContentFactory,
    editorServices: IEditorServices,
    toolbarRegistry: IToolbarWidgetRegistry,
    notebookTracker: INotebookTracker | null,
    settingRegistry: ISettingRegistry | null,
    translator: ITranslator | null
  ) => {
    const { commands, contextMenu } = app;

    const cfgStr = PageConfig.getOption('plainTextNotebookConfig');
    let cfg: IPlainTextNotebookConfig = {};
    try {
      cfg = cfgStr ? JSON.parse(cfgStr) : {};
    } catch {
      console.error('ptjnb: invalid plainTextNotebookConfig JSON');
    }
    const defaultKernelspec: IKernelspec | undefined = cfg.defaultKernelspec;

    await app.serviceManager.kernelspecs.ready;
    const specs = app.serviceManager.kernelspecs.specs;

    const getCurrentBrowser = () => browserFactory.tracker.currentWidget;

    // Reuse toolbar items from standard notebook factory
    const toolbarFactory = settingRegistry
      ? createToolbarFactory(
          toolbarRegistry,
          settingRegistry,
          'Notebook',
          PANEL_SETTINGS,
          translator ?? nullTranslator
        )
      : undefined;

    let ptjnbId = 0;

    const notebookFileType = app.docRegistry.getFileType('notebook');

    // Register one auto-detecting "Notebook" widget factory per extension
    const EXTENSIONS: Array<{
      ext: string;
      fileTypeName: string;
      modelName: string;
    }> = [
      { ext: '.py', fileTypeName: 'ptjnb-py', modelName: 'ptjnb-model-py' },
      { ext: '.md', fileTypeName: 'ptjnb-md', modelName: 'ptjnb-model-md' }
    ];

    for (const { ext, fileTypeName, modelName } of EXTENSIONS) {
      app.docRegistry.addFileType({
        name: fileTypeName,
        extensions: [ext],
        contentType: 'file',
        fileFormat: 'text',
        icon: notebookFileType?.icon ?? notebookIcon
      });

      app.docRegistry.addModelFactory(
        new PlainTextNotebookModelFactory({
          name: modelName,
          ext,
          specs
        })
      );

      const widgetFactory = new NotebookWidgetFactory({
        name: fileTypeName,
        label: 'Notebook',
        modelName,
        fileTypes: [fileTypeName],
        defaultFor: [],
        preferKernel: true,
        canStartKernel: true,
        rendermime,
        contentFactory,
        mimeTypeService: editorServices.mimeTypeService,
        toolbarFactory,
        translator: translator ?? nullTranslator
      });

      // Register each created panel with the notebook tracker.
      widgetFactory.widgetCreated.connect((_sender, widget) => {
        widget.id = widget.id || `ptjnb-${++ptjnbId}`;
        widget.title.icon = notebookFileType?.icon ?? notebookIcon;
        widget.title.iconClass = notebookFileType?.iconClass ?? '';
        widget.title.iconLabel = notebookFileType?.iconLabel ?? '';

        if (notebookTracker) {
          const tracker = notebookTracker as NotebookTracker;
          void tracker.add(widget);
        }
      });

      app.docRegistry.addWidgetFactory(
        widgetFactory as unknown as DocumentRegistry.WidgetFactory
      );

      // Copy any other widget extensions
      void app.restored.then(() => {
        for (const e of app.docRegistry.widgetExtensions('Notebook')) {
          app.docRegistry.addWidgetExtension(fileTypeName, e);
        }
      });
    }

    // "Convert to Notebook" commands keep an explicit per-format choice.
    (Object.keys(PARSERS) as ParserName[]).forEach(parserName => {
      const convertCommandId = `ptjnb:convert-${parserName}`;
      const parser = PARSERS[parserName];
      const exts = PARSER_EXTENSIONS[parserName];

      commands.addCommand(convertCommandId, {
        label: PARSER_LABELS[parserName],
        isVisible: () => {
          const browser = getCurrentBrowser();
          if (!browser) {
            return false;
          }
          const selection = browser.selectedItems();
          const first = selection.next();
          if (first.done || !first.value) {
            return false;
          }
          return exts.some(ext => first.value.path.endsWith(ext));
        },
        execute: async () => {
          const browser = getCurrentBrowser();
          if (!browser) {
            return;
          }
          const selection = browser.selectedItems();
          const first = selection.next();
          if (first.done || !first.value) {
            return;
          }
          const filePath = first.value.path;
          const notebookPath = filePath.replace(/\.(py|md)$/, '.ipynb');
          const contents = app.serviceManager.contents;
          try {
            let fileExists = false;
            try {
              await contents.get(notebookPath, { content: false });
              fileExists = true;
            } catch {
              /* empty */
            }
            if (fileExists) {
              const result = await showDialog({
                title: 'Overwrite notebook?',
                body: `"${notebookPath}" already exists. Overwrite it?`,
                buttons: [
                  Dialog.cancelButton(),
                  Dialog.warnButton({ label: 'Overwrite' })
                ]
              });
              if (!result.button.accept) {
                return;
              }
            }
            await convertFile(
              contents,
              filePath,
              parser,
              defaultKernelspec,
              specs
            );
          } catch (e) {
            console.error('ptjnb: conversion failed', e);
          }
        }
      });
    });

    // Auto-detecting "Convert to Notebook" command
    commands.addCommand('ptjnb:convert-to-notebook', {
      label: 'Convert to Notebook',
      icon: notebookFileType?.icon ?? notebookIcon,
      isVisible: () => {
        const browser = getCurrentBrowser();
        if (!browser) {
          return false;
        }
        const selection = browser.selectedItems();
        const first = selection.next();
        if (first.done || !first.value) {
          return false;
        }
        const path = first.value.path;
        return path.endsWith('.py') || path.endsWith('.md');
      },
      execute: async () => {
        const browser = getCurrentBrowser();
        if (!browser) {
          return;
        }
        const selection = browser.selectedItems();
        const first = selection.next();
        if (first.done || !first.value) {
          return;
        }
        const filePath = first.value.path;
        const notebookPath = filePath.replace(/\.(py|md)$/, '.ipynb');
        const contents = app.serviceManager.contents;
        try {
          let fileExists = false;
          try {
            await contents.get(notebookPath, { content: false });
            fileExists = true;
          } catch {
            /* empty */
          }
          if (fileExists) {
            const result = await showDialog({
              title: 'Overwrite notebook?',
              body: `"${notebookPath}" already exists. Overwrite it?`,
              buttons: [
                Dialog.cancelButton(),
                Dialog.warnButton({ label: 'Overwrite' })
              ]
            });
            if (!result.button.accept) {
              return;
            }
          }
          await convertFileAuto(contents, filePath, defaultKernelspec, specs);
        } catch (e) {
          console.error('ptjnb: conversion failed', e);
        }
      }
    });

    [
      '.jp-DirListing-item[data-isdir="false"][data-file-type="python"]',
      '.jp-DirListing-item[data-isdir="false"][data-file-type="markdown"]',
      '.jp-DirListing-item[data-isdir="false"][data-file-type="ptjnb-py"]',
      '.jp-DirListing-item[data-isdir="false"][data-file-type="ptjnb-md"]'
    ].forEach(selector => {
      contextMenu.addItem({
        command: 'ptjnb:convert-to-notebook',
        selector,
        rank: 10
      });
    });

    // Reverse conversion: .ipynb to plain text
    (Object.keys(SERIALIZERS) as ParserName[]).forEach(parserName => {
      const exportCommandId = `ptjnb:export-${parserName}`;
      const serializer = SERIALIZERS[parserName];
      const targetExt = PARSER_EXTENSIONS[parserName][0];

      commands.addCommand(exportCommandId, {
        label: PARSER_LABELS[parserName],
        isVisible: () => {
          const browser = getCurrentBrowser();
          if (!browser) {
            return false;
          }
          const selection = browser.selectedItems();
          const first = selection.next();
          if (first.done || !first.value) {
            return false;
          }
          return first.value.path.endsWith('.ipynb');
        },
        execute: async () => {
          const browser = getCurrentBrowser();
          if (!browser) {
            return;
          }
          const selection = browser.selectedItems();
          const first = selection.next();
          if (first.done || !first.value) {
            return;
          }
          const notebookPath = first.value.path;
          const plainPath = notebookPath.replace(/\.ipynb$/, targetExt);
          const contents = app.serviceManager.contents;
          try {
            let fileExists = false;
            try {
              await contents.get(plainPath, { content: false });
              fileExists = true;
            } catch {
              // file does not exist
            }
            if (fileExists) {
              const result = await showDialog({
                title: 'Overwrite file?',
                body: `"${plainPath}" already exists. Overwrite it?`,
                buttons: [
                  Dialog.cancelButton(),
                  Dialog.warnButton({ label: 'Overwrite' })
                ]
              });
              if (!result.button.accept) {
                return;
              }
            }
            await convertNotebookToPlainText(
              contents,
              notebookPath,
              serializer,
              targetExt
            );
          } catch (e) {
            console.error('ptjnb: export failed', e);
          }
        }
      });
    });

    const exportSubmenu = new MenuSvg({ commands });
    exportSubmenu.title.label = 'Convert to Plain Text';
    exportSubmenu.addItem({ command: 'ptjnb:export-parsePy' });
    exportSubmenu.addItem({ command: 'ptjnb:export-parseSphinxGallery' });
    exportSubmenu.addItem({ command: 'ptjnb:export-parseClassicMd' });
    exportSubmenu.addItem({ command: 'ptjnb:export-parseMystMd' });

    contextMenu.addItem({
      type: 'submenu',
      submenu: exportSubmenu,
      selector:
        '.jp-DirListing-item[data-isdir="false"][data-file-type="notebook"]',
      rank: 11
    });

    if (cfg.rules?.length) {
      await autoConvert(
        app.serviceManager.contents,
        cfg.rules,
        defaultKernelspec,
        specs
      );
    }
  }
};
