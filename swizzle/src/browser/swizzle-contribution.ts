import { MaybePromise, MessageService } from '@theia/core';
import { ApplicationShell, FrontendApplication, FrontendApplicationContribution, TabBarRenderer } from '@theia/core/lib/browser';
import { FrontendApplicationStateService } from '@theia/core/lib/browser/frontend-application-state';
import { PreferenceScope, PreferenceService } from '@theia/core/lib/browser/preferences';
import { ResourceProvider } from '@theia/core/lib/common';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { URI } from '@theia/core/lib/common/uri';
import { inject, injectable } from '@theia/core/shared/inversify';
import { DebugConsoleContribution } from '@theia/debug/lib/browser/console/debug-console-contribution';
import { EditorManager, EditorWidget } from '@theia/editor/lib/browser';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { starterComponent, starterEndpoint, starterHelper } from './swizzle-starter-code';

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

    @inject(DebugConsoleContribution)
    protected readonly debugConsole: DebugConsoleContribution;

    private previousEditor: EditorWidget | undefined;

    private lastPrependedText?: string;
    private hiddenBackendTerminalId: string = "";
    private hiddenFrontendTerminalId: string = "";
    private permissionsTerminalWidgetId: string = "";

    private frontendTerminalId: string = "";
    private backendTerminalId: string = "";

    private readonly MAIN_DIRECTORY = "/swizzle/code";

    onStart(app: FrontendApplication): MaybePromise<void> {
        console.log("Theia FrontendApplication onStart")

        //Set JWT as cookie in case we missed it
        const urlParams = new URLSearchParams(window.location.search);
        const jwt = urlParams.get('jwt');      
        if(jwt != null){   
            document.cookie = `jwt=${jwt}; path=/; SameSite=None; Secure`;    
        }

        //Only save when changing files
        // this.preferenceService.set('files.autoSave', 'onFocusChange');

        //Listen for incoming messages 
        window.addEventListener('message', this.handlePostMessage.bind(this));

        //Open the terminal, set the styles, and notify the parent that the extension is ready
        this.stateService.reachedState('ready').then(() => {
            this.openTerminal();
            window.parent.postMessage({ type: 'extensionReady' }, '*');

            if(document.getElementById("theia-top-panel") && document.getElementById("theia-left-right-split-panel")){
                document.getElementById("theia-top-panel")!.style.display = 'none'
                document.getElementById("theia-left-right-split-panel")!.style.top = "0px";
            }
            if(document.getElementById("shell-tab-explorer-view-container")){
                document.getElementById("shell-tab-explorer-view-container")!.style.display = 'none'
            }
            if(document.getElementById("shell-tab-scm-view-container")){
                document.getElementById("shell-tab-scm-view-container")!.style.display = 'none'
            }

            const style = document.createElement('style');
            style.innerHTML = `
            li.p-Menu-item[data-command="navigator.reveal"] {
                display: none !important;
            }
            li.p-Menu-item[data-command="core.toggleMaximized"] {
                display: none !important;
            }
            li.p-Menu-item[data-command="typescript.findAllFileReferences"] {
                display: none !important;
            }
            `;
            document.head.appendChild(style);

            if(document.getElementById("theia-statusBar")){
                document.getElementById("theia-statusBar")!.style.display = 'none'
            }

            this.shell.widgets.forEach(widget => {
                if (widget.id === 'problems') { // replace with the actual ID if different
                    widget.close();
                }
            });    

            const originalRenderLabel = TabBarRenderer.prototype.renderLabel;
            TabBarRenderer.prototype.renderLabel = function(data) {
                const label = data.title.label;
                if(label.startsWith("get.") || label.startsWith("post.") || label.startsWith("put.") || label.startsWith("delete.") || label.startsWith("patch.")){
                    const firstDotIndex = label.indexOf('.');
                    const firstPart = label.slice(0, firstDotIndex);
                    const secondPart = label.slice(firstDotIndex + 1);
                    data.title.label = firstPart.toUpperCase() + " /" + secondPart.replace(".ts", "").replace(/\./g, "/").replace(/\(/g, ":").replace(/\)/g, "");
                } else{
                    const owner = data.title.owner
                    if(owner.id.includes("/frontend/src/pages/")){
                        if(owner.id.includes("/frontend/src/pages/SwizzleHomePage.ts")){
                            return "/"
                        }
                        var labelText = label.replace(".ts", "").replace(/\./g, "/").replace(/\(/g, ":").replace(/\)/g, "").toLowerCase();
                        if(!labelText.startsWith("/")){
                            labelText = "/" + labelText
                        }
                        data.title.label = labelText
                    }
                }
                const node = originalRenderLabel.call(this, data);
                return node;
            };

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

    delay(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }    

    protected openTerminal(): void {
        console.log(`Number of terminals open: ${this.terminalService.all.length}`)

        this.terminalService.newTerminal({ hideFromUser: false, isTransient: true, destroyTermOnClose: true, cwd: this.MAIN_DIRECTORY + "/frontend", title: "Frontend Logs" }).then(async terminal => {
            try {
                await terminal.start();
                this.terminalService.open(terminal);
                terminal.sendText(`pkill -f "tail app.log"\n`);
                await this.delay(100)
                terminal.sendText("tail -f app.log\n");
                this.frontendTerminalId = terminal.id;
                terminal.clearOutput()
                console.log("Opened frontend logs terminal" + terminal.id)
            } catch (error) {
                console.log(error)
            }
        }).catch(error => {
            this.messageService.error(`Failed to open the terminal: ${error}`);
            console.log(error);
        });

        this.terminalService.newTerminal({ hideFromUser: false, isTransient: true, destroyTermOnClose: true, cwd: this.MAIN_DIRECTORY + "/backend", title: "Backend Logs" }).then(async terminal => {
            try {
                await terminal.start();
                this.terminalService.open(terminal);
                // terminal.sendText(`pkill -f "/app/tail-logs.sh app.log"\n`);
                // await this.delay(100)
                // terminal.sendText("chmod +x /app/tail-logs.sh\n");
                // terminal.sendText("/app/tail-logs.sh app.log\n");
                terminal.sendText(`pkill -f "tail app.log"\n`);
                await this.delay(100)
                terminal.sendText("tail -f app.log\n");
                this.backendTerminalId = terminal.id;
                terminal.clearOutput()
                console.log("Opened backend logs terminal" + terminal.id)
            } catch (error) {
                console.log(error)
            }
        }).catch(error => {
            this.messageService.error(`Failed to open the terminal: ${error}`);
            console.log(error);
        });

        this.terminalService.newTerminal({ hideFromUser: true, isTransient: true, destroyTermOnClose: true, cwd: this.MAIN_DIRECTORY + "/backend", title: "Backend Packages" }).then(async terminal => {
            try {
                await terminal.start();
                this.hiddenBackendTerminalId = terminal.id;
                console.log("Opened backend package terminal" + terminal.id)
            } catch (error) {
                console.log(error)
            }
        })

        this.terminalService.newTerminal({ hideFromUser: true, isTransient: true, destroyTermOnClose: true, cwd: this.MAIN_DIRECTORY + "/frontend", title: "Frontend Packages" }).then(async terminal => {
            try {
                await terminal.start();
                this.hiddenFrontendTerminalId = terminal.id;
                console.log("Opened frontend package terminal" + terminal.id)
            } catch (error) {
                console.log(error)
            }
        })

        this.terminalService.newTerminal({ hideFromUser: true, isTransient: true, destroyTermOnClose: true, cwd: this.MAIN_DIRECTORY + "/frontend/src", title: "Permissions" }).then(async terminal => {
            try {
                await terminal.start();
                this.permissionsTerminalWidgetId = terminal.id;
                console.log("Opened permissions terminal" + terminal.id)
            } catch (error) {
                console.log(error)
            }
        })

    }

    //Set the file associations
    async setFileAssociations(): Promise<void> {
        this.preferenceService.set('files.defaultLanguage', 'typescript', PreferenceScope.User);

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
    protected async handleEditorChanged(): Promise<void> {
        if (!this.editorManager) { return; }

        //Save previous file
        if (this.previousEditor && this.previousEditor.editor) {
            await this.previousEditor.saveable.save()
        }

        const editor = this.editorManager.currentEditor;
        this.previousEditor = editor;

        if (editor) {
            const fileUri = editor.editor.uri.toString();
            if (editor.editor instanceof MonacoEditor) {
                const monacoEditor = editor.editor.getControl();
                const model = monacoEditor.getModel();
                const fileContents = model?.getValue() || '';

                const hasPassportAuth = fileContents.includes("requiredAuthentication, async");
                const hasGetDb = fileContents.includes("import { db } = from 'swizzle-js'");
                const hasNotification = fileContents.includes("import { sendNotification } = from 'swizzle-js'");
                const hasStorage = fileContents.includes("import { saveFile, getFile, deleteFile } = from 'swizzle-js'");

                const swizzleImportRegex = /import\s+{[^}]*}\s+from\s+['"]swizzle-js['"];?/g;
                const matches = fileContents.match(swizzleImportRegex);
                const importStatement =  matches ? matches[0] : null;
            
                this.openRelevantTerminal(fileUri)

                window.parent.postMessage({
                    type: 'fileChanged',
                    fileUri: fileUri,
                    hasPassportAuth: hasPassportAuth,
                    hasGetDb: hasGetDb, //unused
                    hasNotification: hasNotification, //unused
                    hasStorage: hasStorage, //unused
                    swizzleImportStatement: importStatement,
                }, '*');
            }
        }
    }

    async openRelevantTerminal(fileName: string): Promise<void>{
        var terminalId = ""
        if(fileName.includes("backend/")){
            terminalId = this.backendTerminalId
        } else if(fileName.includes("frontend/")){
            terminalId = this.frontendTerminalId
        }
        const terminal = this.terminalService.all.find(t => t.id === terminalId);
        if (terminal) {
          this.terminalService.open(terminal);
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

    async removeFile(relativeFilePath: string, endpointName: string, routePath: string): Promise<void>{
        console.log("removeFile")
        if(endpointName != undefined && endpointName !== ""){ //remove from server.ts if it's an endpoint
            console.log("remove endpoint")
            const lastIndex = relativeFilePath.lastIndexOf("/");
            var fileName = relativeFilePath.substring(lastIndex + 1);

            const serverUri = new URI(this.MAIN_DIRECTORY + "/backend/server.ts");
            const serverResource = await this.resourceProvider(serverUri);

            if (serverResource.saveContents) {
                const content = await serverResource.readContents({ encoding: 'utf8' });
                        
                const newContent = content
                    .replace(`\napp.use('', require("./user-dependencies/${fileName.replace(/\.ts$/, "")}"));`, ``);
                await serverResource.saveContents(newContent, { encoding: 'utf8' });
            }
        }
        else if(routePath != undefined && routePath !== ""){ //remove from RouteList.ts if it's a route
            console.log("remove route")
            const lastIndex = relativeFilePath.lastIndexOf("/");
            var fileName = relativeFilePath.substring(lastIndex + 1);

            const serverUri = new URI(this.MAIN_DIRECTORY + "/frontend/src/RouteList.tsx");
            const serverResource = await this.resourceProvider(serverUri);

            if (serverResource.saveContents) {
                var content = await serverResource.readContents({ encoding: 'utf8' });

                const routeToRemoveRegex = new RegExp(`<(Route|PrivateRoute)[^>]*path="${routePath}"[^>]*element={<[^>]+>}[\\s]*\\/>\n?`, 'g');
                content = content.replace(routeToRemoveRegex, '');
              
                const importToRemoveRegex = new RegExp(`import ${fileName.replace(".tsx", "")}.*\n`, 'g');
                content = content.replace(importToRemoveRegex, '');
              
                await serverResource.saveContents(content, { encoding: 'utf8' });
            }
        }

        console.log("removing " + relativeFilePath)
        for (const editorWidget of this.editorManager.all) {
            const editorUri = editorWidget.getResourceUri();
            const filePath = "file://" + this.MAIN_DIRECTORY + relativeFilePath;
            console.log(decodeURIComponent(editorUri?.toString() ?? "") + " =?= " + filePath)
            if (decodeURIComponent(editorUri?.toString() ?? "") === filePath) {
                editorWidget.close();
            }
        }
    }

    //accepts something like get-path-to-api.ts or post-.ts
    async createNewFile(relativeFilePath: string, endpointName: string, routePath: string, fallbackPath: string): Promise<void> {
        try {
            var filePath = this.MAIN_DIRECTORY + relativeFilePath
            const uri = new URI(filePath);
            const resource = await this.resourceProvider(uri);

            var fileName = ""
            if(relativeFilePath.includes("user-dependencies/")){
                const lastIndex = relativeFilePath.lastIndexOf("/");
                fileName = relativeFilePath.substring(lastIndex + 1);

                const method = endpointName.split("/")[0];
                const endpoint = endpointName.substring(endpointName.indexOf("/"));

                const fileContent = starterEndpoint(method, endpoint);

                if (resource.saveContents) {
                    await resource.saveContents(fileContent, { encoding: 'utf8' });
                }

                //add the reference to server.ts
                const serverUri = new URI(this.MAIN_DIRECTORY + "/backend/server.ts");
                const serverResource = await this.resourceProvider(serverUri);
                if (serverResource.saveContents) {
                    const content = await serverResource.readContents({ encoding: 'utf8' });

                    // Search for block of endpoints in server.ts and using the capture group to get all the endpoints.
                    const regex = /\/\/SWIZZLE_ENDPOINTS_START([\s\S]*)\/\/SWIZZLE_ENDPOINTS_END/g;
                    const result = regex.exec(content);

                    // If we can't find the endpoints block, then just return
                    if (!result || result.length < 2) {
                        console.log("Could not find endpoints block in server.ts");
                        return;
                    }

                    // Turn the endpoints into individual lines removing all indendation so the sort is consistent
                    const lines = result![1]
                        .split("\n")
                        .filter((line) => line.trim().length > 0)
                        .map(line => line.trim())

                    // Include our new endpoint
                    lines.push(`app.use('', require("./user-dependencies/${fileName.replace(/\.ts$/, "")}"));`)

                    // Sort all the endpoints in reverse order to guarantee that endpoints with path parameters
                    // come second after endpoints that don't have path parameters. For example, consider the following
                    // two endpoints:
                    //
                    //      app.use('', require("./user-dependencies/post.(test)"));
                    //      app.use('', require("./user-dependencies/post.test"));
                    //
                    //  These endpoints represent
                    //
                    //      POST /:test
                    //      POST /test
                    //
                    //  Now if a POST request comes into /test, then the ordering matters. Since /:test appears first,
                    //  that endpoint will be called with the parameter :test = test. This means that it overshadows
                    //  the other /test endpoint. 
                    //
                    //  Sorting in reverse lexicographic order will produce the following:
                    //
                    //      app.use('', require("./user-dependencies/post.test"));
                    //      app.use('', require("./user-dependencies/post.(test)"));
                    //
                    //  This is the correct order we want.
                    const sortedBlock = lines
                        .sort((a, b) => b.localeCompare(a))
                        .join("\n");

                    const endpointsBlock = `//SWIZZLE_ENDPOINTS_START\n${sortedBlock}\n\t//SWIZZLE_ENDPOINTS_END`;
                    const newContent = content.replace(regex, endpointsBlock);

                    await serverResource.saveContents(newContent, { encoding: 'utf8' });
                }
                
            } else if (relativeFilePath.includes("frontend/")) {
                const lastIndex = relativeFilePath.lastIndexOf("/");
                fileName = relativeFilePath.substring(lastIndex + 1);

                const basePath = relativeFilePath.split("frontend/src/")[1]

                const componentName = basePath
                    .replace(".tsx", "")
                    .replace(".ts", "")
                    .slice(basePath.lastIndexOf('/') + 1)
                    .replace(/\./g, "_")
                    .replace(/^(.)/, (match, p1) => p1.toUpperCase())
                    .replace(/_([a-z])/g, (match, p1) => '_' + p1.toUpperCase());
              
                const hasAuth = fallbackPath != undefined && fallbackPath !== ""
                var fileContent = starterComponent(componentName, hasAuth, basePath);

                if (resource.saveContents) {
                    await resource.saveContents(fileContent, { encoding: 'utf8' });
                }

                //check if this is a subdirectory
                if (basePath.includes("/")) {
                    const newDirectory = basePath.split("/")[0]
                    const terminal = this.terminalService.all.find(t => t.id === this.permissionsTerminalWidgetId);
                    terminal?.sendText(`chmod -R 777 ${newDirectory}\n`)
                    console.log(`sent chmod for ${newDirectory} to terminal ${this.permissionsTerminalWidgetId}`)
                }

                if(routePath != undefined && routePath !== ""){
                    //Add route to RouteList.ts
                    const importStatement = `import ${componentName} from './${basePath.replace(".tsx", "")}';`
                    var newRouteDefinition = `<SwizzleRoute path="${routePath}" element={<${componentName} />} />`
                    if(fallbackPath != undefined && fallbackPath !== ""){
                        newRouteDefinition = `<SwizzlePrivateRoute path="${routePath}" unauthenticatedFallback="${fallbackPath}" element={<${componentName} />} />`
                    }

                    const serverUri = new URI(this.MAIN_DIRECTORY + "/frontend/src/RouteList.tsx");
                    const serverResource = await this.resourceProvider(serverUri);
                    if (serverResource.saveContents) {
                        var content = await serverResource.readContents({ encoding: 'utf8' });

                        //Update imports
                        const importRegex = /(import .*\n)+/;
                        const importMatch = content.match(importRegex);
                        if (importMatch) {
                          const newImportBlock = importMatch[0] + importStatement + '\n';
                          content = content.replace(importRegex, newImportBlock);
                        }                      

                        //Update routes
                        const switchRegex = /(<SwizzleRoutes>[\s\S]*?<\/SwizzleRoutes>)/;
                        const match = content.match(switchRegex);
                        if (match){
                            const oldSwitchBlock = match[1];
                            const sortedRoutes = this.addAndSortRoute(oldSwitchBlock, newRouteDefinition);
                            const newSwitchBlock = `<SwizzleRoutes>\n  ${sortedRoutes}\n</SwizzleRoutes>`;
                            content = content.replace(oldSwitchBlock, newSwitchBlock);
                        }

                        //Save new file
                        await serverResource.saveContents(content, { encoding: 'utf8' });
                    }    
                }

            } else if (relativeFilePath.includes("helpers/")) {
                fileName = filePath.split("backend/helpers/")[1];
                var fileContent = starterHelper(fileName.replace(".ts", ""))
                
                if (resource.saveContents) {
                    await resource.saveContents(fileContent, { encoding: 'utf8' });
                }
            }

        } catch (error) {
            console.log(error)
        }
    }

    addAndSortRoute(switchBlock: string, newRoute: string): string {
        const routeRegex = /<SwizzleRoute[^>]*path="([^"]*)"[^>]*element={<[^>]*\/>}[^>]*\/>/g;
        let routes: string[] = [];
        let match: RegExpExecArray | null;
        while (match = routeRegex.exec(switchBlock)) {
            routes.push(match[0]);
        }
        routes.push(newRoute);
    
        routes.sort((a, b) => {
            const pathA = a.match(/path="([^"]*)"/)?.[1] ?? '';
            const pathB = b.match(/path="([^"]*)"/)?.[1] ?? '';
            return (pathA.match(/\//g) || []).length - (pathB.match(/\//g) || []).length;
        });
    
        return routes.join('\n  ');
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

    async closeSearchView(): Promise<void> {
        this.shell.collapsePanel("left")
    }
    async openSearchView(): Promise<void> {
        await this.commandRegistry.executeCommand('search-in-workspace.open');
    }

    async openDebugger(): Promise<void> {
        this.shell.revealWidget("debug")
        await this.commandRegistry.executeCommand('workbench.action.debug.start');
        this.debugConsole.openView({
            reveal: true,
            activate: true
        });
    }
    async closeDebugger(): Promise<void> {
        this.shell.collapsePanel("left")
        await this.commandRegistry.executeCommand('workbench.action.debug.stop');
        this.shell.widgets.forEach(widget => {
            if (widget.id === 'debug-console') {
                widget.close();
            }
        });

        //In case the debugger is still open, close it
        setTimeout(() => {
            this.shell.collapsePanel("left")
        }, 500);
    }

    async runCommand(command: any): Promise<void> {
        await this.commandRegistry.executeCommand(command);
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
            this.openExistingFile(event.data.fileName)
            this.openRelevantTerminal(event.data.fileName)
        } else if (event.data.type === 'newFile') {
            this.createNewFile(event.data.fileName, event.data.endpointName, event.data.routePath, event.data.fallbackPath);
        } else if (event.data.type === 'saveFile') {
            this.saveCurrentFile();
        } else if(event.data.type === 'closeFiles'){
            this.closeOpenFiles();
        } else if(event.data.type === 'removeFile'){
            this.removeFile(event.data.fileName, event.data.endpointName, event.data.routePath) 
        } else if(event.data.type === 'closeSearchView'){
            this.closeSearchView() 
        } else if(event.data.type === 'openSearchView'){
            this.openSearchView() 
        } else if(event.data.type === 'openDebugger'){
            this.openDebugger() 
        } else if(event.data.type === 'closeDebugger'){
            this.closeDebugger() 
        } else if(event.data.type === 'runCommand'){
            this.runCommand(event.data.command)
        } else if (event.data.type === 'saveCookie') {
            const cookieValue = event.data.cookieValue;
            const cookieName = event.data.cookieName;
            document.cookie = cookieName+"="+cookieValue+"; path=/";
        } else if (event.data.type === 'addPackage') {
            const packageName = event.data.packageName;
            const directory = event.data.directory;
            const terminalWidget = directory == "backend" ? this.terminalService.getById(this.hiddenBackendTerminalId!) : this.terminalService.getById(this.hiddenFrontendTerminalId!)
            if (!terminalWidget) {
                this.messageService.error(`Terminal not found`);
                return;
            }
            terminalWidget.sendText(`npm install ${packageName} --save\n`);
        } else if (event.data.type === 'removePackage') {
            const packageName = event.data.packageName;
            const directory = event.data.directory;
            const terminalWidget = directory == "backend" ? this.terminalService.getById(this.hiddenBackendTerminalId!) : this.terminalService.getById(this.hiddenFrontendTerminalId!)
            if (!terminalWidget) {
                this.messageService.error(`Terminal not found`);
                return;
            }
            terminalWidget.sendText(`npm uninstall ${packageName}\n`);
        } else if (event.data.type === 'findAndReplace') {
            const textToFind = event.data.findText;
            const replaceWith = event.data.replaceText;    
            this.findAndReplace(textToFind, replaceWith)
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

    findAndReplace(textToFind: string, replaceWith: string){
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
    }
}
