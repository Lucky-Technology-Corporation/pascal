/**
 * Generated using theia-extension-generator
 */
import { ContainerModule } from '@theia/core/shared/inversify';
import { SwizzleContribution } from './swizzle-contribution';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { PluginVSCodeContribution } from '@theia/plugin-ext-vscode/lib/browser/plugin-vscode-contribution';
// import { UserStorageContribution } from '@theia/userstorage/lib/browser/user-storage-contribution';

export default new ContainerModule((bind, unbind) => {
    bind(SwizzleContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(SwizzleContribution);
    
    // bind(PluginVSCodeContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(PluginVSCodeContribution);

    // bind(UserStorageContribution).toSelf().inSingletonScope();
    // bind(FrontendApplicationContribution).toService(UserStorageContribution);


    bind(FrontendApplicationContribution).toDynamicValue(ctx => ({
        onStart(): void {
            const style = document.createElement('style');
            style.type = 'text/css';
            style.innerHTML = '.theia-tabBar-breadcrumb-row{display:none!important}.theia-app-main{background:var(--theia-editor-background)!important}'
            document.getElementsByTagName('head')[0].appendChild(style);
        }
    })).inSingletonScope();

});
