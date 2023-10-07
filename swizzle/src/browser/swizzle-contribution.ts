import { MaybePromise, MessageService } from '@theia/core';
import { ApplicationShell, FrontendApplication, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { FrontendApplicationStateService } from '@theia/core/lib/browser/frontend-application-state';
import { PreferenceScope, PreferenceService } from '@theia/core/lib/browser/preferences';
import { ResourceProvider } from '@theia/core/lib/common';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { URI } from '@theia/core/lib/common/uri';
import { inject, injectable } from '@theia/core/shared/inversify';
import { EditorManager, EditorWidget } from '@theia/editor/lib/browser';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { starterCSS, starterEndpoint, starterHTML } from './swizzle-starter-code';

@injectable()
export class SwizzleContribution implements FrontendApplicationContribution {

    @inject(EditorManager)
    protected readonly editorManager!: EditorManager;

    @inject(MessageService)
    protected readonly messageService!: MessageService;

    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;

    @inject(TerminalService)
    protected readonly terminalService!: TerminalService;

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

    private lastPrependedText?: string;
    private terminalWidgetId: string = "";

    private readonly MAIN_DIRECTORY = "/swizzle/code/";

    onStart(app: FrontendApplication): MaybePromise<void> {
        console.log("Theia FrontendApplication onStart")

        //Set JWT as cookie in case we missed it
        const urlParams = new URLSearchParams(window.location.search);
        const jwt = urlParams.get('jwt');      
        if(jwt != null){   
            document.cookie = `jwt=${jwt}; path=/;`;    
        }

        //Clear past layouts
        localStorage.clear()

        //Open the code directory
        const specificDirectoryUri = 'file://'+this.MAIN_DIRECTORY;
        this.workspaceService.recentWorkspaces().then((workspaces) => {
            console.log("last workspace: " + workspaces[0])
            if(workspaces.length == 0){
                this.workspaceService.open(new URI(specificDirectoryUri), { preserveWindow: true })
            }
            if(workspaces.length > 0 && workspaces[0] !== specificDirectoryUri){
                this.workspaceService.open(new URI(specificDirectoryUri), { preserveWindow: true })
            }
        })

        //Only save when changing files
        this.preferenceService.set('files.autoSave', 'onFocusChange');

        //Listen for incoming messages 
        window.addEventListener('message', this.handlePostMessage.bind(this));

        //Open the terminal, set the styles, and notify the parent that the extension is ready
        this.stateService.reachedState('ready').then(() => {
            this.openTerminal();
            window.parent.postMessage({ type: 'extensionReady' }, '*');

            if(document.getElementById("theia-top-panel") && document.getElementById("theia-left-right-split-panel")){
                document.getElementById("theia-top-panel")!.remove();
                document.getElementById("theia-left-right-split-panel")!.style.top = "0px";
            }

            // if(document.getElementById("theia-left-content-panel")){
            //     document.getElementById("theia-left-content-panel")!.style.display = "none";
            // }

            console.log("Swizzle editor extension ready")
        });

        //Set the file associations
        this.setFileAssociations();

        //Listen for file changes
        this.editorManager.onCurrentEditorChanged(this.handleEditorChanged.bind(this));
    }

    //No op the initialize layout
    initializeLayout(app: FrontendApplication): MaybePromise<void> {
        return Promise.resolve();
    }

    protected openTerminal(): void {
        this.terminalService.newTerminal({ hideFromUser: false, isTransient: true, title: "Logs" }).then(async terminal => {
            try {
                await terminal.start();
                this.terminalService.open(terminal);
                terminal.sendText("cd " + this.MAIN_DIRECTORY + "\n");
                terminal.sendText(`pkill -f "/app/tail-logs.sh app.log"\n`);
                terminal.sendText("chmod +x /app/tail-logs.sh\n");
                terminal.sendText("/app/tail-logs.sh app.log\n");
                terminal.sendText("clear\n");

                //Disable user input. TODO: I don't think this is working, not even sure if this is a good idea?
                const terminalElement = terminal.node.querySelector('.xterm-helper-textarea');
                if (terminalElement) {
                    terminalElement.setAttribute('readonly', 'true');
                }

                console.log("Opened log terminal" + terminal.id)
            } catch (error) {
                console.log(error)
            }
        }).catch(error => {
            this.messageService.error(`Failed to open the terminal: ${error}`);
            console.log(error);
        });

        this.terminalService.newTerminal({ hideFromUser: true, isTransient: true, title: "Packages" }).then(async terminal => {
            try {
                await terminal.start();
                terminal.sendText("cd " + this.MAIN_DIRECTORY + "\nclear\n");
                this.terminalWidgetId = terminal.id;
                console.log("Opened package terminal" + terminal.id)
            } catch (error) {
                console.log(error)
            }
        })
    }

    //Set the file associations
    async setFileAssociations(): Promise<void> {
        this.preferenceService.set('files.defaultLanguage', 'javascript', PreferenceScope.User);

        const existingAssociations = this.preferenceService.get('files.associations') || {};
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
        await this.preferenceService.set('files.associations', newAssociations, PreferenceScope.User);
    }


    //Notify the parent that the current file has changed
    protected handleEditorChanged(): void {
        if (!this.editorManager) { return; }
        const editor = this.editorManager.currentEditor;
        if (editor) {
            const fileUri = editor.editor.uri.toString();
            if (editor.editor instanceof MonacoEditor) {
                const monacoEditor = editor.editor.getControl();
                const model = monacoEditor.getModel();
                const fileContents = model?.getValue() || '';

                const hasPassportAuth = fileContents.includes("requiredAuthentication");
                const hasGetDb = fileContents.includes("const { db } = require('swizzle-js')");
                const hasNotification = fileContents.includes("const { sendNotification } = require('swizzle-js')");
                const hasStorage = fileContents.includes("const { saveFile, getFile, deleteFile } = require('swizzle-js')");

                window.parent.postMessage({
                    type: 'fileChanged',
                    fileUri: fileUri,
                    hasPassportAuth: hasPassportAuth,
                    hasGetDb: hasGetDb,
                    hasNotification: hasNotification,
                    hasStorage: hasStorage
                }, '*');
            }
        }
    }

    async openExistingFile(fileName: string): Promise<void> {
        if (fileName == undefined || fileName === "") { return; }
        // await this.closeCurrentFile();
        const fileUri = this.MAIN_DIRECTORY + fileName;
        console.log("opening " + fileUri)
        if (fileUri) {
            this.editorManager.open(new URI(fileUri)).then((editorWidget: EditorWidget) => {
                if (editorWidget) {
                    this.shell.activateWidget(editorWidget.id);
                }
            }).catch(error => {
                this.messageService.error(`Failed to open the file: ${error}`);
            });
        }
    }

    //accepts something like get-path-to-api.js or post-.js
    async createNewFile(relativeFilePath: string, endpointName: string): Promise<void> {
        try {
            var filePath = this.MAIN_DIRECTORY + relativeFilePath
            const uri = new URI(filePath);
            const resource = await this.resourceProvider(uri);

            var fileName = ""
            if(relativeFilePath.includes("user-dependencies/")){
                const lastIndex = relativeFilePath.lastIndexOf("/");
                fileName = relativeFilePath.substring(lastIndex + 1);

                const method = endpointName.split("/")[0];
                const endpoint = endpointName.split("/")[1];

                const fileContent = starterEndpoint(method, endpoint);

                if (resource.saveContents) {
                    await resource.saveContents(fileContent, { encoding: 'utf8' });
                }

                //add the reference to server.js
                const serverUri = new URI(this.MAIN_DIRECTORY + "server.js");
                const serverResource = await this.resourceProvider(serverUri);
                if (serverResource.saveContents) {
                    const content = await serverResource.readContents({ encoding: 'utf8' });
                    
                    //Remove extension and replace dashes with underscores
                    var requireName = fileName.replace(".js", "").replace(/-/g, "_");
                    
                    //Remove the path
                    const lastIndex = requireName.lastIndexOf("/");
                    requireName = requireName.substring(lastIndex + 1);
                    
                    //TODO: check this
                    //Remove leading underscore
                    // if(requireName.startsWith("_")){ requireName = requireName.substring(1); }
                    
                    const newContent = content
                        .replace("//_SWIZZLE_NEWREQUIREENTRYPOINT", `//_SWIZZLE_NEWREQUIREENTRYPOINT\nconst ${requireName} = require("./user-dependencies/${fileName}");`)
                        .replace("//_SWIZZLE_NEWENDPOINTENTRYPOINT", `//_SWIZZLE_NEWENDPOINTENTRYPOINT\napp.use('', ${requireName});`);
                    await serverResource.saveContents(newContent, { encoding: 'utf8' });
                }
            } else if (relativeFilePath.includes("user-hosting/")) {

                fileName = filePath.replace("user-hosting/", "");

                var fileContent = "";
                if (fileName.includes(".html")) {
                    fileContent = starterHTML();
                } else if (fileName.includes(".css")) {
                    fileContent = starterCSS()
                }

                if (resource.saveContents) {
                    await resource.saveContents(fileContent, { encoding: 'utf8' });
                }
            } else if (relativeFilePath.includes("user-helpers/")) {

                fileName = filePath.replace("/user-helpers/", "");

                var fileContent = `global.${fileName} = function() {\n\n}`;

                if (resource.saveContents) {
                    await resource.saveContents(fileContent, { encoding: 'utf8' });
                }
            }

            this.openExistingFile(fileName)

        } catch (error) {
            console.log(error)
        }
    }

    async saveCurrentFile(): Promise<void> {
        const currentEditor = this.editorManager.currentEditor;

        if (currentEditor) {
            const uri = currentEditor.editor.uri;
            const resource = await this.resourceProvider(uri);

            if (resource.saveContents) {
                const editorModel = currentEditor.editor.document;
                if (editorModel) {
                    const content = editorModel.getText();
                    await resource.saveContents(content, { encoding: 'utf8' });
                }
            }
        }
        return
    }


    async closeOpenFiles(): Promise<void> {
        console.log("Close open files")
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
        if (event.data.type === 'openFile') {
            // this.saveCurrentFile();
            this.openExistingFile(event.data.fileName)
        } else if (event.data.type === 'newFile') {
            // this.saveCurrentFile();
            this.createNewFile(event.data.fileName, event.data.endpointName);
        } else if (event.data.type === 'saveFile') {
            this.saveCurrentFile();
        } else if (event.data.type === 'reloadServer') {
            
        } else if (event.data.type === 'saveCookie') {
            const cookieValue = event.data.cookieValue;
            const cookieName = event.data.cookieName;
            document.cookie = cookieName+"="+cookieValue+"; path=/";
        } else if (event.data.type === 'addPackage') {
            const packageName = event.data.packageName;
            const terminalWidget = this.terminalService.getById(this.terminalWidgetId!)
            if (!terminalWidget) {
                this.messageService.error(`Terminal not found`);
                return;
            }
            terminalWidget.sendText(`npm install ${packageName} --save\n`);
        } else if (event.data.type === 'removePackage') {
            const packageName = event.data.packageName;
            const terminalWidget = this.terminalService.getById(this.terminalWidgetId!)
            if (!terminalWidget) {
                this.messageService.error(`Terminal not found`);
                return;
            }
            terminalWidget.sendText(`npm uninstall ${packageName}\n`);
        } else if (event.data.type === 'findAndReplace') {
            const textToFind = event.data.findText;
            const replaceWith = event.data.replaceText;
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
                                endColumn: end.column
                            };
        
                            editOperations.push({
                                range: findRange,
                                text: replaceWith,
                                forceMoveMarkers: true
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
        } else if (event.data.type === 'prependText') {
            const content = event.data.content;
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
                            const range = { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column };

                            model.pushEditOperations(
                                [],
                                [{ range: range, text: '', forceMoveMarkers: true }],
                                () => null
                            );
                        }
                    }

                    if (content && content !== "") {
                        // Prepend new content
                        const prependEdit = {
                            identifier: { major: 1, minor: 1 },
                            range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
                            text: content,
                            forceMoveMarkers: true
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
        } else if (event.data.type === 'replaceText') {
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
        }
    }
}
