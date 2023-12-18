import { MaybePromise, MessageService } from "@theia/core";
import {
  ApplicationShell,
  FrontendApplication,
  FrontendApplicationContribution,
  KeybindingRegistry,
  TabBarRenderer
} from "@theia/core/lib/browser";
import { FrontendApplicationStateService } from "@theia/core/lib/browser/frontend-application-state";
import {
  PreferenceScope,
  PreferenceService,
} from "@theia/core/lib/browser/preferences";
import { ResourceProvider } from "@theia/core/lib/common";
import { CommandRegistry } from "@theia/core/lib/common/command";
import { URI } from "@theia/core/lib/common/uri";
import { inject, injectable } from "@theia/core/shared/inversify";
import { DebugConsoleContribution } from "@theia/debug/lib/browser/console/debug-console-contribution";
import { EditorManager, EditorWidget } from "@theia/editor/lib/browser";
import { ProblemManager } from "@theia/markers/lib/browser/problem/problem-manager";
import { MonacoEditor } from "@theia/monaco/lib/browser/monaco-editor";
import { WorkspaceService } from "@theia/workspace/lib/browser";

@injectable()
export class SwizzleContribution implements FrontendApplicationContribution {
  @inject(EditorManager)
  protected readonly editorManager!: EditorManager;

  @inject(MessageService)
  protected readonly messageService!: MessageService;

  @inject(ApplicationShell)
  protected readonly shell!: ApplicationShell;

  @inject(PreferenceService)
  protected readonly preferenceService: PreferenceService;

  @inject(ResourceProvider)
  protected readonly resourceProvider!: ResourceProvider;

  @inject(FrontendApplicationStateService)
  protected readonly stateService: FrontendApplicationStateService;

  @inject(WorkspaceService)
  protected readonly workspaceService: WorkspaceService;

  @inject(CommandRegistry)
  protected readonly commandRegistry: CommandRegistry;

  @inject(KeybindingRegistry)
  protected readonly keybindingRegistry: KeybindingRegistry;

  @inject(DebugConsoleContribution)
  protected readonly debugConsole: DebugConsoleContribution;

  @inject(ProblemManager)
  protected readonly problemManager: ProblemManager;


  private previousEditor: EditorWidget | undefined;

  private lastPrependedText?: string;

  private readonly MAIN_DIRECTORY = "/swizzle/code";

  onStart(app: FrontendApplication): MaybePromise<void> {
    console.log("Theia 12.15.23");

    //Set JWT as cookie in case we missed it
    const urlParams = new URLSearchParams(window.location.search);
    const jwt = urlParams.get("jwt");
    if (jwt != null) {
      document.cookie = `jwt=${jwt}; path=/; SameSite=None; Secure`;
    }

    //Only save when changing files
    // this.preferenceService.set('files.autoSave', 'onFocusChange');

    //Listen for incoming messages
    window.addEventListener("message", this.handlePostMessage.bind(this));

    //Set the styles, and notify the parent that the extension is ready
    this.stateService.reachedState("ready").then(() => {
      window.parent.postMessage({ type: "extensionReady" }, "*");

      if (
        document.getElementById("theia-top-panel") &&
        document.getElementById("theia-left-right-split-panel")
      ) {
        document.getElementById("theia-top-panel")!.style.display = "none";
        document.getElementById("theia-left-right-split-panel")!.style.top =
          "0px";
      }
      if (document.getElementById("shell-tab-explorer-view-container")) {
        document.getElementById(
          "shell-tab-explorer-view-container",
        )!.style.display = "none";
      }
      if (document.getElementById("shell-tab-scm-view-container")) {
        document.getElementById("shell-tab-scm-view-container")!.style.display =
          "none";
      }

      const style = document.createElement("style");
      style.innerHTML = `
            li.p-Menu-item[data-command="navigator.reveal"] {
                display: none !important;
            }
            li.p-Menu-item[data-command="core.toggleMaximized"] {
                display: none !important;
            }
            li.p-Menu-item[data-command="typehierarchy:open-subtype"] {
                display: none !important;
            }
            li.p-Menu-item[data-command="typehierarchy:open-supertype"] {
              display: none !important;
            }
            li.p-Menu-item[data-command="open-disassembly-view"] {
              display: none !important;
            }
            li.p-Menu-item[data-command="editor.action.quickOutline"] {
              display: none !important;
            }
            `;
      document.head.appendChild(style);

      if (document.getElementById("theia-statusBar")) {
        document.getElementById("theia-statusBar")!.style.display = "none";
      }

      this.shell.widgets.forEach((widget) => {
        if (widget.id === "problems") {
          // replace with the actual ID if different
          widget.close();
        }
      });

      const originalRenderLabel = TabBarRenderer.prototype.renderLabel;
      TabBarRenderer.prototype.renderLabel = function (data) {
        const label = data.title.label;
        if (
          label.startsWith("get.") ||
          label.startsWith("post.") ||
          label.startsWith("put.") ||
          label.startsWith("delete.") ||
          label.startsWith("patch.")
        ) {
          const firstDotIndex = label.indexOf(".");
          const firstPart = label.slice(0, firstDotIndex);
          const secondPart = label.slice(firstDotIndex + 1);
          if(secondPart.includes(".cron.")){
            data.title.label = "⏲ " + secondPart.split(".cron.")[1]
          } else{
            data.title.label =
              firstPart.toUpperCase() +
              " /" +
              secondPart
                .replace(".ts", "")
                .replace(/\./g, "/")
                .replace(/\(/g, ":")
                .replace(/\)/g, "");
          }
        } else {
          const owner = data.title.owner;
          if (owner.id.includes("/frontend/src/pages/")) {
            if (owner.id.includes("/frontend/src/pages/SwizzleHomePage")) {
              return "/";
            }
            var labelText = label
              .replace(".tsx", "")
              .replace(/\./g, "/")
              .replace(/\(/g, ":")
              .replace(/\)/g, "")
              .replace(/\$/g, ":")
              .toLowerCase();
            if (!labelText.startsWith("/")) {
              labelText = "/" + labelText;
            }
            data.title.label = labelText;
          }
        }

        const node = originalRenderLabel.call(this, data);
        return node;
      };

      //Register command K
      this.commandRegistry.registerCommand({
        id: 'open-ai',
        label: 'Open AI'
      }, {
        execute: () => {
          console.log("Open AI " + this.getSelectedText())
          window.parent.postMessage(
            {
              type: "openAi",
              selectedText: this.getSelectedText(),
            },
            "*",
          );
        }
      });
      this.keybindingRegistry.registerKeybinding({
        command: 'open-ai',
        keybinding: 'ctrlcmd+k'
      });


      console.log("Swizzle editor extension ready");
    });

    //Set the file associations
    this.setFileAssociations();

    //Listen for file changes
    this.editorManager.onCurrentEditorChanged(
      this.handleEditorChanged.bind(this),
    );

  }

  //No op the initialize layout
  initializeLayout(app: FrontendApplication): MaybePromise<void> {
    return Promise.resolve();
  }

  delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  //Set the file associations
  async setFileAssociations(): Promise<void> {
    this.preferenceService.set(
      "files.defaultLanguage",
      "typescript",
      PreferenceScope.User,
    );

    this.preferenceService.set(
      "editor.tabSize",
      2,
      PreferenceScope.User,
    );

    const existingAssociations =
      this.preferenceService.get("files.associations") || {};
    const newAssociations = {
      ...(existingAssociations as { [key: string]: string }),
      "*.ts": "typescript",
      "*.tsx": "typescriptreact",
      "*.js": "javascript",
      "*.jsx": "javascriptreact",
      "*.json": "jsonc",
      "*.md": "markdown",
      "*.mdx": "markdown",
      "*.html": "html",
      "*.css": "css",
      "*.scss": "scss",
    };
    await this.preferenceService.set(
      "files.associations",
      newAssociations,
      PreferenceScope.User,
    );
  }

  //Notify the parent that the current file has changed
  protected async handleEditorChanged(): Promise<void> {
    if (!this.editorManager) {
      return;
    }

    //Save previous file
    if (this.previousEditor && this.previousEditor.editor && this.previousEditor.saveable.dirty) {
      await this.previousEditor.saveable.save();
    }

    const editor = this.editorManager.currentEditor;
    this.previousEditor = editor;

    if (editor) {
      const fileUri = editor.editor.uri.toString();
      if (editor.editor instanceof MonacoEditor) {
        const monacoEditor = editor.editor.getControl();
        const model = monacoEditor.getModel();
        const fileContents = model?.getValue() || "";

        const hasPassportAuth = fileContents.includes(
          "requiredAuthentication, async",
        );

        const hasGetDb = fileContents.includes(
          "import { db } = from 'swizzle-js'",
        );
        const hasNotification = fileContents.includes(
          "import { sendNotification } = from 'swizzle-js'",
        );
        const hasStorage = fileContents.includes(
          "import { saveFile, getFile, deleteFile } = from 'swizzle-js'",
        );

        const swizzleImportRegex =
          /import\s+{[^}]*}\s+from\s+['"]swizzle-js['"];?/g;
        const matches = fileContents.match(swizzleImportRegex);
        const importStatement = matches ? matches[0] : null;

        window.parent.postMessage(
          {
            type: "fileChanged",
            fileUri: fileUri,
            hasPassportAuth: hasPassportAuth,
            hasGetDb: hasGetDb, //unused
            hasNotification: hasNotification, //unused
            hasStorage: hasStorage, //unused
            swizzleImportStatement: importStatement,
          },
          "*",
        );
      }
    }
  }

  async openExistingFile(fileName: string, line?: number, column?: number): Promise<void> {
    if (fileName == undefined || fileName === "") {
      return;
    }
    // await this.closeCurrentFile();
    const fileUri = this.MAIN_DIRECTORY + fileName;
    if (fileUri) {
      this.editorManager
        .open(new URI(fileUri))
        .then((editorWidget: EditorWidget) => {
          if (editorWidget) {
            this.shell.activateWidget(editorWidget.id);
            if (line && column) {
              editorWidget.editor.revealPosition({line: line, character: column})
            }
          }
        })
        .catch((error) => {
          this.messageService.error(`Failed to open the file: ${error}`);
        });
    }
  }

  async removeFile(relativeFilePath: string): Promise<void> {
    for (const editorWidget of this.editorManager.all) {
      const editorUri = editorWidget.getResourceUri();
      const filePath = "file://" + this.MAIN_DIRECTORY + relativeFilePath;
      if (decodeURIComponent(editorUri?.toString() ?? "") === filePath) {
        editorWidget.close();
      }
    }
  }


  async saveCurrentFile(): Promise<void> {
    const currentEditor = this.editorManager.currentEditor;

    if (currentEditor) {
      await currentEditor.saveable.save()
    }
  }

  async closeSearchView(): Promise<void> {
    this.shell.collapsePanel("left");
  }
  async openSearchView(): Promise<void> {
    await this.commandRegistry.executeCommand("search-in-workspace.open");
  }

  async openDebugger(): Promise<void> {
    this.shell.revealWidget("debug");
    await this.commandRegistry.executeCommand("workbench.action.debug.start");
    this.debugConsole.openView({
      reveal: true,
      activate: true,
    });
  }
  async closeDebugger(): Promise<void> {
    this.shell.collapsePanel("left");
    await this.commandRegistry.executeCommand("workbench.action.debug.stop");
    this.shell.widgets.forEach((widget) => {
      if (widget.id === "debug-console") {
        widget.close();
      }
    });

    //In case the debugger is still open, close it
    setTimeout(() => {
      this.shell.collapsePanel("left");
    }, 500);
  }

  async runCommand(command: any): Promise<void> {
    await this.commandRegistry.executeCommand(command);
  }

  async closeOpenFiles(): Promise<void> {
    for (const editorWidget of this.editorManager.all) {
      editorWidget.close();
    }
  }

  protected async closeCurrentFile(): Promise<void> {
    await this.saveCurrentFile();
    const editorWidget = this.editorManager.currentEditor;
    if (editorWidget) {
      this.shell.closeWidget(editorWidget.id);
    }
  }

  protected async handlePostMessage(event: MessageEvent): Promise<void> {
    // Check the origin or some other authentication method if necessary
    if (event.data.type === "openFile") {
      this.openExistingFile(event.data.fileName, event.data.line, event.data.column);
    } else if (event.data.type === "newFile") {
      console.log("no-op")
    } else if (event.data.type === "saveFile") {
      this.saveCurrentFile();
    } else if (event.data.type === "closeFiles") {
      this.closeOpenFiles();
    } else if (event.data.type === "removeFile") {
      this.removeFile(event.data.fileName);
    } else if (event.data.type === "closeSearchView") {
      this.closeSearchView();
    } else if (event.data.type === "openSearchView") {
      this.openSearchView();
    } else if (event.data.type === "openDebugger") {
      this.openDebugger();
    } else if (event.data.type === "closeDebugger") {
      this.closeDebugger();
    } else if (event.data.type === "runCommand") {
      this.runCommand(event.data.command);
    } else if (event.data.type === "saveCookie") {
      const cookieValue = event.data.cookieValue;
      const cookieName = event.data.cookieName;
      document.cookie = cookieName + "=" + cookieValue + "; path=/";
    } else if (event.data.type === "findAndReplace") {
      const textToFind = event.data.findText;
      const replaceWith = event.data.replaceText;
      this.findAndReplace(textToFind, replaceWith);
    } else if (event.data.type === "upsertImport") {
      const textToFind = event.data.importStatement; //this is separate so we can search for the text without a line break (e.g. when a comment is on that line)
      if(!this.doesTextExist(textToFind)){
        this.prependText(event.data.content)
      }
    } else if (event.data.type === "prependText") {
      this.prependText(event.data.content)
    } else if (event.data.type === "replaceText") {
      const newContent = event.data.content;
      const currentEditorWidget = this.editorManager.currentEditor;

      if (currentEditorWidget) {
        const editor = currentEditorWidget.editor;

        if (editor instanceof MonacoEditor) {
          const monacoEditor = editor.getControl();
          const model = monacoEditor.getModel();

          if (model) {
            // Replace entire content
            model.setValue(newContent);
          }
        }
      }
    } else if(event.data.type === "getSelectedText"){
      const selectedText = this.getSelectedText();
      window.parent.postMessage(
        {
          type: "selectedText",
          selectedText: selectedText,
        },
        "*",
      );
    } else if(event.data.type === "replaceSelectedText"){
      const editor = this.editorManager.currentEditor;
      if (editor) {
        const selection = editor.editor.selection;
        const selectedText = editor.editor.document.getText(selection);
        //Leading whitespace
        const match = selectedText.match(/^\s*/);
        const prefix = match ? match[0] : '';
        //Trailing newline
        const suffix = selectedText.endsWith("\n") ? "\n" : "";
        editor.editor.replaceText({replaceOperations: [{range: selection, text: prefix + event.data.content + suffix}], source: editor.id});
      }
    } else if(event.data.type === "getFileErrors"){
      var thisFilesErrors: any[] = []
      var allFilesErrors: any[] = []

      this.problemManager.findMarkers().forEach((marker) => {
        console.log(JSON.stringify(marker))
        if(marker.uri == this.editorManager.currentEditor?.editor.uri.toString()){
          thisFilesErrors.push(marker.data)
        }
        allFilesErrors.push(marker)
      })

      window.parent.postMessage({
        type: "fileErrors",
        thisFilesErrors: JSON.stringify(thisFilesErrors),
        allFilesErrors: JSON.stringify(allFilesErrors)
      }, "*")

    }
  }

  getSelectedText(): string | undefined {
    const editor = this.editorManager.currentEditor;
    if (editor) {
        const selection = editor.editor.selection;
        const text = editor.editor.document.getText(selection);
        return text;
    }
    return undefined;
  }

  doesTextExist(textToFind: string): boolean {
    const currentEditorWidget = this.editorManager.currentEditor;

    if (currentEditorWidget) {
      const editor = currentEditorWidget.editor;

      if (editor instanceof MonacoEditor) {
        const monacoEditor = editor.getControl();
        const model = monacoEditor.getModel();

        if (model) {
          const docContent = model.getValue();
          let findStartIndex = docContent.indexOf(textToFind);
          return (findStartIndex !== -1)
        }
      }
    }
    
    return true
  }

  prependText(content: string){
    const currentEditorWidget = this.editorManager.currentEditor;

    if (currentEditorWidget) {
      const editor = currentEditorWidget.editor;

      if (editor instanceof MonacoEditor) {
        const monacoEditor = editor.getControl();
        const model = monacoEditor.getModel();

        if (model && this.lastPrependedText) {
          const oldContent = model.getValue();
          const startIndex = oldContent.indexOf(this.lastPrependedText);

          if (startIndex !== -1) {
            const endIndex = startIndex + this.lastPrependedText.length;
            const start = model.getPositionAt(startIndex);
            const end = model.getPositionAt(endIndex);
            const range = {
              startLineNumber: start.lineNumber,
              startColumn: start.column,
              endLineNumber: end.lineNumber,
              endColumn: end.column,
            };

            model.pushEditOperations(
              [],
              [{ range: range, text: "", forceMoveMarkers: true }],
              () => null,
            );
          }
        }

        if (content && content !== "") {
          // Prepend new content
          const prependEdit = {
            identifier: { major: 1, minor: 1 },
            range: {
              startLineNumber: 1,
              startColumn: 1,
              endLineNumber: 1,
              endColumn: 1,
            },
            text: content,
            forceMoveMarkers: true,
          };

          model?.pushEditOperations([], [prependEdit], () => null);

          // Save the prepended text for future removal
          this.lastPrependedText = content;
        } else {
          // If new content is an empty string, clear lastPrependedText
          this.lastPrependedText = undefined;
        }
      }
    }
  }

  findAndReplace(textToFind: string, replaceWith: string) {
    const currentEditorWidget = this.editorManager.currentEditor;

    if (currentEditorWidget) {
      const editor = currentEditorWidget.editor;

      if (editor instanceof MonacoEditor) {
        const monacoEditor = editor.getControl();
        const model = monacoEditor.getModel();

        if (model) {
          const docContent = model.getValue();
          let findStartIndex = docContent.indexOf(textToFind);
          const editOperations = [];

          while (findStartIndex !== -1) {
            const findEndIndex = findStartIndex + textToFind.length;
            const start = model.getPositionAt(findStartIndex);
            const end = model.getPositionAt(findEndIndex);

            const findRange = {
              startLineNumber: start.lineNumber,
              startColumn: start.column,
              endLineNumber: end.lineNumber,
              endColumn: end.column,
            };

            editOperations.push({
              range: findRange,
              text: replaceWith,
              forceMoveMarkers: true,
            });

            findStartIndex = docContent.indexOf(textToFind, findEndIndex);
          }

          // Execute all replace operations
          if (editOperations.length > 0) {
            model.pushEditOperations([], editOperations, () => null);
          }
        }
      }
    }
  }
}
