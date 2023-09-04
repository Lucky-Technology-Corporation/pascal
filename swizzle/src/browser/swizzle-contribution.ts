import { injectable, inject } from '@theia/core/shared/inversify';
import { EditorManager, EditorWidget } from '@theia/editor/lib/browser';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import { MessageService } from '@theia/core';
import { ApplicationShell, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import URI from '@theia/core/lib/common/uri'; 
import { PreferenceScope, PreferenceService } from '@theia/core/lib/browser/preferences';
import { ResourceProvider } from '@theia/core/lib/common';
import { FrontendApplicationStateService } from '@theia/core/lib/browser/frontend-application-state';
import { WorkspaceService } from '@theia/workspace/lib/browser';

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

    private lastPrependedText?: string;
    private terminalWidgetId: string = "";

    // private readonly MAIN_DIRECTORY = "/home/swizzle_prod_user/code/";
    private readonly MAIN_DIRECTORY = "/Users/adam/Downloads/";

    onStart(): void {
        //Set the root
        this.workspaceService.addRoot(new URI(this.MAIN_DIRECTORY));

        //Listen for incoming messages 
        window.addEventListener('message', this.handlePostMessage.bind(this));

        //Remove the localstorage
        localStorage.removeItem('editor-navigation-contribution'); 

        this.stateService.reachedState('ready').then(() => {
            this.openTerminal();
            window.parent.postMessage({ type: 'extensionReady' }, '*');
        });

        //Set the file associations
        this.setFileAssociations();

        //Listen for file changes
        this.editorManager.onCurrentEditorChanged(this.handleEditorChanged.bind(this));    
    }

    protected openTerminal(): void{
        this.terminalService.newTerminal({hideFromUser: false, isTransient: true, title: "Logs"}).then(async terminal => {
            try{
                await terminal.start();
                this.terminalService.open(terminal);
                terminal.sendText("cd " + this.MAIN_DIRECTORY + "\nclear\ntail -f app.log\n");
                this.terminalWidgetId = terminal.id;
           } catch(error){
                console.log(error)
            }
        }).catch(error => {
            this.messageService.error(`Failed to open the terminal: ${error}`);
            console.log(error);
        });
    }

    async closeOpenFiles(): Promise<void> {
        for (const editorWidget of this.editorManager.all) {
            editorWidget.close();
        }
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
        if(!this.editorManager){ return; }
        const editor = this.editorManager.currentEditor;
        if (editor) {
            const fileUri = editor.editor.uri.toString();
            if (editor.editor instanceof MonacoEditor) {
                const monacoEditor = editor.editor.getControl();
                const model = monacoEditor.getModel();
                const fileContents = model?.getValue() || '';
    
                const hasPassportAuth = fileContents.includes("passport.authenticate('jwt', { session: false })");
                const hasGetDb = fileContents.includes("const db = getDb()");
                
                window.parent.postMessage({
                    type: 'fileChanged',
                    fileUri: fileUri,
                    hasPassportAuth: hasPassportAuth,
                    hasGetDb: hasGetDb
                }, '*');
            }
        }
    }

    async openExistingFile(fileName: string): Promise<void> {
        if(fileName == undefined || fileName === ""){ return; }
        const fileUri = this.MAIN_DIRECTORY + "user-dependencies/" + fileName;
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
    async createNewFile(fileName: string): Promise<void> {
        try{
            var filePath = this.MAIN_DIRECTORY + "user-dependencies/" + fileName
            const uri = new URI(filePath);
            const resource = await this.resourceProvider(uri);

            const method = fileName.split("-")[0];
            const endpoint = fileName.replace(".js", "").split("-").slice(1).join("/")

            const fileContent = 
`const express = require('express');
const router = express.Router();
const passport = require('passport');
//TODO: Add Swizzle NPM package!

router.${method}('/${endpoint}', async (request, result) => {
});`

            if (resource.saveContents) {
                await resource.saveContents(fileContent, { encoding: 'utf8' });
            }

            //add the reference to server.js
            const serverUri = new URI(this.MAIN_DIRECTORY + "server.js");
            const serverResource = await this.resourceProvider(serverUri);
            if (serverResource.saveContents) {
                const content = await serverResource.readContents({ encoding: 'utf8' });
                
                var requireName = fileName.replace(".js", "").replace(/-/g, "_");
                if(requireName.startsWith("_")){ requireName = requireName.substring(1); }
                var endpointPath = fileName.replace(".js", "").replace(/-/g, "/").replace("get", "").replace("post", "").replace("put", "").replace("delete", "");
                
                const newContent = content
                    .replace("//_SWIZZLE_NEWREQUIREENTRYPOINT", `//_SWIZZLE_NEWREQUIREENTRYPOINT\nconst ${requireName} = require("./user-dependencies/${fileName}");`)
                    .replace("//_SWIZZLE_NEWENDPOINTENTRYPOINT", `//_SWIZZLE_NEWENDPOINTENTRYPOINT\napp.use("${endpointPath}", ${requireName});`);
                await serverResource.saveContents(newContent, { encoding: 'utf8' });
            }

            this.openExistingFile(fileName)

        } catch(error){
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
                    const content = currentEditor.editor.document.getText();
                    await resource.saveContents(content, { encoding: 'utf8' });
                }
            }
        }
    }

    protected async closeCurrentFile(): Promise<void> {
        await this.saveCurrentFile();
        const editor = this.editorManager.currentEditor;
        if (editor) {
            editor.close();
        }
    }

    protected handlePostMessage(event: MessageEvent): void {
        // Check the origin or some other authentication method if necessary
        if (event.data.type === 'openFile') {
            this.closeCurrentFile().then(() => {
                this.openExistingFile(event.data.fileName)
            });
        } else if(event.data.type === 'newFile'){
            this.closeCurrentFile().then(() => {
                this.createNewFile(event.data.fileName);
            });
        } else if(event.data.type === 'saveFile'){
            this.saveCurrentFile();
        } else if(event.data.type === 'addPackage'){
            const packageName = event.data.packageName;
            const terminalWidget = this.terminalService.getById(this.terminalWidgetId!)
            if(!terminalWidget){
                this.messageService.error(`Terminal not found`);
                return;
            }
            terminalWidget.sendText(`npm install ${packageName} --save-dev`);
        } else if(event.data.type === 'findAndReplace'){ 
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
                        const findStartIndex = docContent.indexOf(textToFind);
            
                        if (findStartIndex !== -1) {
                            const findEndIndex = findStartIndex + textToFind.length;
            
                            const start = model.getPositionAt(findStartIndex);
                            const end = model.getPositionAt(findEndIndex);
            
                            const findRange = {
                                startLineNumber: start.lineNumber,
                                startColumn: start.column,
                                endLineNumber: end.lineNumber,
                                endColumn: end.column
                            };
            
                            // Execute replace
                            model.pushEditOperations(
                                [],
                                [{ range: findRange, text: replaceWith, forceMoveMarkers: true }],
                                () => null
                            );
                        }
                    }
                }
            }            
        } else if(event.data.type === 'prependText'){
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
            
        }
    }
}
