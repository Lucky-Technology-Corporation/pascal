import { injectable } from 'inversify';
import { EditorNavigationContribution } from '@theia/editor/lib/browser/editor-navigation-contribution';

@injectable()
export class SwizzleEditorNavigationContribution extends EditorNavigationContribution {
    protected async restoreState(): Promise<void> {
        // Override to disable restoring editor state from local storage
    }

    protected async restoreNavigationLocations(): Promise<void> {
        // Override to disable restoring editor state from local storage
    }
}
