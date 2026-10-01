import { html, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { newestFirst, text, type Entity } from '../records.js'
import { shell } from '../shell.js'
import { strings } from '../strings.js'
import { listDetail, nameField, noticeLine } from './parts.js'
import { VaultScreen } from './screen.js'
import './session-form.js'
import { sessionTable, subjectPicker, toggled } from './session-parts.js'

/** Groups: their members, and the sessions held with them. */
@customElement('oc-groups')
export class OcGroups extends VaultScreen {
  @state() private selectedGroup?: string
  @state() private groupName = ''
  /** The document is the form for adding a group, rather than a group's members and sessions. */
  @state() private adding = false
  /** While the window is narrow: the document shows instead of the list. */
  @state() private documentOpen = false
  /** The selected group's members as being edited; undefined while unchanged. */
  @state() private memberDraft?: string[]
  /** Who took part in the group session being recorded; undefined means the group's members. */
  @state() private attendeeDraft?: string[]
  /** Sessions whose written content is open under their row. */
  @state() private openNotes = new Set<string>()
  /** The session open for correcting. */
  @state() private correcting?: string

  private async addGroup() {
    const name = this.groupName.trim()
    if (!name) return this.store.problem('no-name')
    await this.store.run(async () => {
      const path = await shell.record('/changes/group', { fields: { name, members: [] } })
      this.groupName = ''
      await this.store.load()
      this.selectGroup(path.split('/')[1])
    })
  }

  private selectGroup(id: string) {
    this.correcting = undefined
    this.selectedGroup = id
    this.memberDraft = undefined
    this.attendeeDraft = undefined
    this.adding = false
    this.documentOpen = true
  }

  private async saveMembers(group: Entity) {
    const members = this.memberDraft
    if (!members) return
    await this.store.run(async () => {
      await shell.record('/changes/update', { type: 'group', id: group.id, fields: { members } })
      this.memberDraft = undefined
      await this.store.load()
    })
  }

  /** A group's members as recorded. */
  private membersOf(groupId: string): string[] {
    const members = this.store.groups.find((g) => g.id === groupId)?.fields.members
    return Array.isArray(members) ? members.filter((m): m is string => typeof m === 'string') : []
  }

  /** Who the group session being recorded is about: as picked, or else the group's members. */
  private attendeesOf(groupId: string): string[] {
    return this.attendeeDraft ?? this.membersOf(groupId)
  }

  protected screen() {
    const { groups } = this.store
    const group = this.adding ? undefined : groups.find((g) => g.id === this.selectedGroup)
    return listDetail({
      label: strings.groups,
      head: html`<dc-button
        variant="secondary"
        size="sm"
        @click=${() => {
          this.adding = true
          this.documentOpen = true
        }}
        >${strings.newGroup}</dc-button
      >`,
      entries: groups.map((g) => ({ id: g.id, label: text(g, 'name') })),
      selected: this.adding ? undefined : this.selectedGroup,
      select: (id) => this.selectGroup(id),
      empty: strings.noGroups,
      document: this.adding ? this.addForm() : group ? this.groupDetail(group) : html`<p class="muted">${strings.pickGroup}</p>`,
      open: this.documentOpen,
      back: () => (this.documentOpen = false),
    })
  }

  private addForm() {
    const busy = this.store.busy
    const addGroup = () => void this.addGroup()
    return html`<h2>${strings.addGroup}</h2>
      <div class="row">
        ${nameField(busy, strings.groupName, this.groupName, (v) => (this.groupName = v), addGroup)}
        <dc-button variant="primary" ?disabled=${busy} @click=${addGroup}>${strings.addGroup}</dc-button>
      </div>`
  }

  private groupDetail(group: Entity) {
    const store = this.store
    const sessions = newestFirst(store.sessions.filter((s) => s.group === group.id))
    const correcting = sessions.find((s) => s.id === this.correcting)
    return html`
      <h2>${strings.sessions(text(group, 'name'))}</h2>
      ${correcting
        ? html`<oc-session-form
            .store=${store}
            .holder=${{ kind: 'group', id: group.id }}
            .edit=${correcting}
            @oc-session-edited=${() => (this.correcting = undefined)}
            @oc-edit-cancelled=${() => (this.correcting = undefined)}
          ></oc-session-form>`
        : nothing}
      <div class="form" data-role="members">
        ${subjectPicker(store, strings.groupMembers, () => this.memberDraft ?? this.membersOf(group.id), (ids) => (this.memberDraft = ids))}
        <div class="row">
          <dc-button variant="secondary" ?disabled=${store.busy || !this.memberDraft} @click=${() => void this.saveMembers(group)}
            >${strings.saveMembers}</dc-button
          >
        </div>
      </div>
      <oc-session-form
        .store=${store}
        .holder=${{ kind: 'group', id: group.id }}
        .attendees=${this.attendeesOf(group.id)}
        @oc-session-recorded=${() => (this.attendeeDraft = undefined)}
        >${subjectPicker(store, strings.attendees, () => this.attendeesOf(group.id), (ids) => (this.attendeeDraft = ids))}</oc-session-form
      >
      ${sessions.length === 0
        ? html`<p class="muted">${strings.noSessions}</p>`
        : html`<p class="muted">${strings.sessionCount(sessions.length)}</p>
            ${sessionTable(store, {
              sessions,
              attendees: true,
              openNotes: this.openNotes,
              toggleNote: (id) => (this.openNotes = toggled(this.openNotes, id)),
              correct: (id) => {
                this.store.set({ notice: '' })
                this.correcting = id
              },
            })}`}
      ${noticeLine(store)}
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'oc-groups': OcGroups
  }
}
