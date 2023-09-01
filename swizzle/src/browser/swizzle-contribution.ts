import { injectable, inject } from '@theia/core/shared/inversify';
import { EditorManager, EditorWidget } from '@theia/editor/lib/browser';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import { MessageService } from '@theia/core';
import { ApplicationShell, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import URI from '@theia/core/lib/common/uri'; 
import { PreferenceScope, PreferenceService } from '@theia/core/lib/browser/preferences';
import { ResourceProvider } from '@theia/core/lib/common';

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
    
    private lastPrependedText?: string;
    private terminalWidgetId: string = "";

    onStart(): void {
        //Listen for incoming messages 
        window.addEventListener('message', this.handlePostMessage.bind(this));
        //Notify the parent that the extension is ready
        window.parent.postMessage({ type: 'extensionReady' }, '*');


        //Open the terminal in 1 second
        // setTimeout(() => {
        //     this.terminalService.newTerminal({hideFromUser: false, isTransient: true, title: "Console"}).then(async terminal => {
        //         try{
        //             await terminal.start();
        //             this.terminalService.open(terminal);
        //             this.terminalWidgetId = terminal.id;
        //        }catch(error){
        //             console.log(error)
        //         }
        //     }).catch(error => {
        //         this.messageService.error(`Failed to open the terminal: ${error}`);
        //         console.log(error);
        //     })
        // }, 1000);

        //Set the file associations
        this.setFileAssociations();

        //Listen for file changes
        this.editorManager.onCurrentEditorChanged(this.handleEditorChanged.bind(this));    
        
        //Close all open files
        this.closeOpenFiles();
    }

    async closeOpenFiles(): Promise<void> {
        setTimeout(() => {
            for (const editorWidget of this.editorManager.all) {
                console.log("Closing " + editorWidget.editor.uri.toString());
                editorWidget.close();
            }
        }, 1000);
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
        const editor = this.editorManager.currentEditor;
        if (editor) {
            const fileUri = editor.editor.uri.toString();
            window.parent.postMessage({ type: 'fileChanged', fileUri: fileUri }, '*');
        }
    }

    async openExistingFile(fileName: string): Promise<void> {
        const fileUri = "/home/swizzle_prod_user/code/user-dependencies/" + fileName;
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

    async createNewFile(fileName: string): Promise<void> {
        var filePath = "/home/swizzle_prod_user/code/user-dependencies/" + fileName;
        const uri = new URI(filePath);
        const resource = await this.resourceProvider(uri);
        
        if (resource.saveContents) {
            await resource.saveContents('', { encoding: 'utf8' });
        }

        //add the reference to server.js
        const serverUri = new URI("/home/swizzle_prod_user/code/server.js");
        const serverResource = await this.resourceProvider(serverUri);
        if (serverResource.saveContents) {
            const content = await serverResource.readContents({ encoding: 'utf8' });
            const reqiureName = fileName.replace(".js", "").replace(/-/g, "_");
            var endpointPath = fileName.replace(".js", "").replace(/-/g, "/");
            if(!endpointPath.startsWith("/")){ endpointPath = "/" + endpointPath; }
            
            const newContent = content
                .replace("//_SWIZZLE_NEWREQUIREENTRYPOINT", `//_SWIZZLE_NEWREQUIREENTRYPOINT\nconst ${reqiureName} = require("./user-dependencies/${filePath}");`)
                .replace("_SWIZZLE_NEWENDPOINTENTRYPOINT", `//_SWIZZLE_NEWENDPOINTENTRYPOINT\napp.use("${endpointPath}", ${reqiureName});`);
            
            await serverResource.saveContents(newContent, { encoding: 'utf8' });
        }
    }

    async saveCurrentFile(): Promise<void> {
        const currentEditor = this.editorManager.currentEditor;
        
        if (currentEditor) {
            const uri = currentEditor.editor.uri;
            const resource = await this.resourceProvider(uri);
            
            if (resource.saveContents) {
                const content = currentEditor.editor.document.getText();
                await resource.saveContents(content, { encoding: 'utf8' });
            }
        }
    }

    protected closeCurrentFile(): void {
        const editor = this.editorManager.currentEditor;
        if (editor) {
            editor.close();
        }
    }

    protected handlePostMessage(event: MessageEvent): void {
        // Check the origin or some other authentication method if necessary
        if (event.data.type === 'openFile') {
            this.closeCurrentFile()
            this.openExistingFile(event.data.fileName)
        } else if(event.data.type === 'newFile'){
            this.closeCurrentFile()
            this.createNewFile(event.data.fileName);
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
        } else if(event.data.type === 'prependText'){
            console.log("prependText " + event.data.content);
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
