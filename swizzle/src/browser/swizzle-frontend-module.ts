/**
 * Generated using theia-extension-generator
 */
import { ContainerModule } from '@theia/core/shared/inversify';
import { SwizzleContribution } from './swizzle-contribution';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { PluginVSCodeContribution } from '@theia/plugin-ext-vscode/lib/browser/plugin-vscode-contribution';
import { DebugService } from '@theia/debug/lib/common/debug-service';
import { SwizzleEditorNavigationContribution } from './swizzle-editor-navigation-contribution';
import { EditorNavigationContribution } from '@theia/editor/lib/browser/editor-navigation-contribution';
import { MessageService } from '@theia/core/lib/common/message-service';
import { NoOpMessageService } from './message-service';

export default new ContainerModule((bind, unbind) => {
    bind(SwizzleContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(SwizzleContribution);
    bind(FrontendApplicationContribution).toService(PluginVSCodeContribution);
    bind(FrontendApplicationContribution).toService(DebugService);

    unbind(EditorNavigationContribution);
    bind(EditorNavigationContribution).to(SwizzleEditorNavigationContribution).inSingletonScope();
    
    unbind(MessageService);
    bind(MessageService).to(NoOpMessageService).inSingletonScope();
      

    bind(FrontendApplicationContribution).toDynamicValue(ctx => ({
        onStart(): void {
            const style = document.createElement('style');
            style.type = 'text/css';
            style.innerHTML = '.theia-tabBar-breadcrumb-row{display:none!important}.theia-app-main{background:var(--theia-editor-background)!important}'
            document.getElementsByTagName('head')[0].appendChild(style);
        }
    })).inSingletonScope();

});
