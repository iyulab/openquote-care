import { html } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { labelOf, namesOf, newestFirst, text, type Entity } from '../records.js'
import { shell } from '../shell.js'
import { strings } from '../strings.js'
import { nameField } from './parts.js'
import { VaultScreen } from './screen.js'
import './session-form.js'
import { subjectPicker } from './session-parts.js'

/** Groups: their members, and the sessions held with them. */
@customElement('oc-groups')
export class OcGroups extends VaultScreen {
  @state() private selectedGroup?: string
  @state() private groupName = ''
  /** The selected group's members as being edited; undefined while unchanged. */
  @state() private memberDraft?: string[]
  /** Who took part in the group session being recorded; undefined means the group's members. */
  @state() private attendeeDraft?: string[]

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
    this.selectedGroup = id
    this.memberDraft = undefined
    this.attendeeDraft = undefined
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
    const { busy, groups } = this.store
    const group = groups.find((g) => g.id === this.selectedGroup)
    const addGroup = () => void this.addGroup()
    return html`<div class="columns">
      <section>
        <div class="row">
          ${nameField(busy, strings.groupName, this.groupName, (v) => (this.groupName = v), addGroup)}
          <dc-button variant="secondary" ?disabled=${busy} @click=${addGroup}>${strings.addGroup}</dc-button>
        </div>
        ${groups.length === 0
          ? html`<p class="muted">${strings.noGroups}</p>`
          : html`<ul aria-label=${strings.groups}>
              ${groups.map(
                (g) => html`<li>
                  <button aria-current=${g.id === this.selectedGroup ? 'true' : 'false'} @click=${() => this.selectGroup(g.id)}>
                    ${text(g, 'name')}
                  </button>
                </li>`,
              )}
            </ul>`}
      </section>
      <section>${group ? this.groupDetail(group) : html`<p class="muted">${strings.pickGroup}</p>`}</section>
    </div>`
  }

  private groupDetail(group: Entity) {
    const store = this.store
    const sessions = newestFirst(store.sessions.filter((s) => s.group === group.id))
    const names = new Map(store.practitioners.map((p) => [p.id, text(p, 'name')]))
    const subjectNames = new Map(store.subjects.map((s) => [s.id, text(s, 'name')]))
    return html`
      <h2>${strings.sessions(text(group, 'name'))}</h2>
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
            <table>
              <thead>
                <tr>
                  <th>${strings.sessionDate}</th>
                  <th>${strings.sessionTopic}</th>
                  <th>${strings.attendees}</th>
                  <th>${strings.sessionPractitioner}</th>
                </tr>
              </thead>
              <tbody>
                ${sessions.map(
                  (s) => html`<tr data-session=${s.id}>
                    <td>${text(s, 'date')}</td>
                    <td>${labelOf(store.schemes, s.fields.topic)}</td>
                    <td>${namesOf(s, subjectNames)}</td>
                    <td>${names.get(text(s, 'practitioner')) ?? ''}</td>
                  </tr>`,
                )}
              </tbody>
            </table>`}
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'oc-groups': OcGroups
  }
}
