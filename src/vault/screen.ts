import { LitElement, css, nothing } from 'lit'
import { property } from 'lit/decorators.js'
import { StoreController, type VaultStore } from './store.js'
import { vaultStyles } from './styles.js'

/** An element drawn from the open vault's store: it updates whenever the store changes. */
export class StoreElement extends LitElement {
  // The host adds no box of its own: what it draws lays out as if written in place.
  static styles = [vaultStyles, css`:host { display: contents; }`]

  @property({ attribute: false }) store!: VaultStore

  constructor() {
    super()
    new StoreController(this, () => this.store)
  }
}

/**
 * One of the vault's screens. All of them stay in the page so that what a person left in one is
 * still there when they come back to it; only the screen in view draws anything.
 */
export class VaultScreen extends StoreElement {
  @property({ type: Boolean, reflect: true }) active = false

  render() {
    return this.active ? this.screen() : nothing
  }

  protected screen(): unknown {
    return nothing
  }
}
