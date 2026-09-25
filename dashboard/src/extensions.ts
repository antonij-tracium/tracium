import type { ComponentType, ReactNode } from 'react';
import type { Workspace } from './modules/shell/interfaces';

export type ExtensionId = `extension:${string}`;
export interface ExtensionPageProps {
  workspace: Workspace | null;
  navigate: (view: string) => void;
}
export interface ExtensionPage {
  id: ExtensionId;
  label: string;
  icon?: ReactNode;
  component: ComponentType<ExtensionPageProps>;
  /** Account-level pages remain usable before the first workspace exists. */
  requiresWorkspace?: boolean;
}
export interface SettingsSection {
  id: ExtensionId;
  label: string;
  icon?: ReactNode;
  component: ComponentType<{ workspace: Workspace | null }>;
}
export interface AuthAppearance {
  tagline?: string;
  footer?: string;
  /** Shows a "Forgot password?" link on the login page pointing here when set. */
  forgotPasswordHref?: string;
}
export interface AuthRoute { path: string; element: ReactNode }
/** Props for extra content an embedding application renders inside the signup form. */
export interface SignupFieldsProps {
  /** Reports values to send with the registration request, under `extensions` in its JSON body. */
  onChange: (fields: Record<string, string>) => void;
  /** Increments after every failed submission, so single-use values can be refreshed. */
  attempt: number;
}
export interface DashboardExtensions {
  authAppearance?: AuthAppearance;
  /** Extra routes rendered alongside /login and /signup for logged-out visitors. */
  authRoutes?: readonly AuthRoute[];
  /** Rendered inside the signup form above the submit button (e.g. a CAPTCHA widget).
   * The core API ignores the values; the embedding application checks them. */
  signupFields?: ComponentType<SignupFieldsProps>;
  pages?: readonly ExtensionPage[];
  settingsSections?: readonly SettingsSection[];
  /** Wraps the authenticated application; render children once onboarding completes. */
  onboarding?: ComponentType<{ children: ReactNode }>;
}
export const EMPTY_EXTENSIONS: DashboardExtensions = {};

export function validateExtensions(extensions: DashboardExtensions): void {
  for (const entries of [extensions.pages ?? [], extensions.settingsSections ?? []]) {
    const ids = new Set<string>();
    for (const entry of entries) {
      if (!/^extension:[a-z][a-z0-9-]*$/.test(entry.id) || ids.has(entry.id)) {
        throw new Error(`Invalid or duplicate extension id: ${entry.id}`);
      }
      ids.add(entry.id);
    }
  }
}
