/**
 * Route Group Manager
 * Handles CRUD operations for route groups
 */

import type { RouteGroup, RouteGroupMember } from "./types";

export class RouteGroupManager {
  private groups: Map<string, RouteGroup> = new Map();

  constructor(initialGroups: RouteGroup[] = []) {
    for (const group of initialGroups) {
      this.groups.set(group.id, group);
    }
  }

  /**
   * Create a new route group
   */
  create(group: Omit<RouteGroup, "id"> & { id?: string }): RouteGroup {
    const id = group.id ?? this.generateId();

    if (this.groups.has(id)) {
      throw new Error(`Route group with id '${id}' already exists`);
    }

    const newGroup: RouteGroup = {
      ...group,
      id,
      enabled: group.enabled ?? true,
      members: group.members ?? [],
    };

    this.validateGroup(newGroup);
    this.groups.set(id, newGroup);

    return newGroup;
  }

  /**
   * Get a route group by ID
   */
  get(id: string): RouteGroup | undefined {
    return this.groups.get(id);
  }

  /**
   * Get all route groups
   */
  list(): RouteGroup[] {
    return Array.from(this.groups.values());
  }

  /**
   * Update a route group
   */
  update(id: string, updates: Partial<RouteGroup>): RouteGroup {
    const existing = this.groups.get(id);
    if (!existing) {
      throw new Error(`Route group '${id}' not found`);
    }

    const updated: RouteGroup = {
      ...existing,
      ...updates,
      id, // ID cannot be changed
    };

    this.validateGroup(updated);
    this.groups.set(id, updated);

    return updated;
  }

  /**
   * Delete a route group
   */
  delete(id: string): boolean {
    return this.groups.delete(id);
  }

  /**
   * Add a member to a route group
   */
  addMember(groupId: string, member: RouteGroupMember): RouteGroup {
    const group = this.groups.get(groupId);
    if (!group) {
      throw new Error(`Route group '${groupId}' not found`);
    }

    const updated: RouteGroup = {
      ...group,
      members: [
        ...group.members,
        { ...member, enabled: member.enabled ?? true },
      ],
    };

    this.groups.set(groupId, updated);
    return updated;
  }

  /**
   * Remove a member from a route group
   */
  removeMember(groupId: string, memberIndex: number): RouteGroup {
    const group = this.groups.get(groupId);
    if (!group) {
      throw new Error(`Route group '${groupId}' not found`);
    }

    if (memberIndex < 0 || memberIndex >= group.members.length) {
      throw new Error(`Invalid member index: ${memberIndex}`);
    }

    const updated: RouteGroup = {
      ...group,
      members: group.members.filter((_, i) => i !== memberIndex),
    };

    this.groups.set(groupId, updated);
    return updated;
  }

  /**
   * Update a member in a route group
   */
  updateMember(
    groupId: string,
    memberIndex: number,
    updates: Partial<RouteGroupMember>,
  ): RouteGroup {
    const group = this.groups.get(groupId);
    if (!group) {
      throw new Error(`Route group '${groupId}' not found`);
    }

    if (memberIndex < 0 || memberIndex >= group.members.length) {
      throw new Error(`Invalid member index: ${memberIndex}`);
    }

    const updatedMembers = [...group.members];
    updatedMembers[memberIndex] = {
      ...updatedMembers[memberIndex],
      ...updates,
    };

    const updated: RouteGroup = {
      ...group,
      members: updatedMembers,
    };

    this.groups.set(groupId, updated);
    return updated;
  }

  /**
   * Enable/disable a route group
   */
  setEnabled(id: string, enabled: boolean): RouteGroup {
    return this.update(id, { enabled });
  }

  /**
   * Validate a route group
   */
  private validateGroup(group: RouteGroup): void {
    if (!group.id || group.id.trim() === "") {
      throw new Error("Route group ID is required");
    }

    if (!group.name || group.name.trim() === "") {
      throw new Error("Route group name is required");
    }

    if (!group.strategy) {
      throw new Error("Route group strategy is required");
    }

    if (!Array.isArray(group.members)) {
      throw new Error("Route group members must be an array");
    }

    // Validate each member
    for (let i = 0; i < group.members.length; i++) {
      const member = group.members[i];
      if (!member.provider || member.provider.trim() === "") {
        throw new Error(`Member ${i}: provider is required`);
      }
      if (!member.model || member.model.trim() === "") {
        throw new Error(`Member ${i}: model is required`);
      }
    }
  }

  /**
   * Generate a unique ID for a route group
   */
  private generateId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `group-${timestamp}-${random}`;
  }

  /**
   * Export all route groups
   */
  export(): RouteGroup[] {
    return this.list();
  }

  /**
   * Import route groups
   */
  import(groups: RouteGroup[], replace: boolean = false): void {
    if (replace) {
      this.groups.clear();
    }

    for (const group of groups) {
      this.validateGroup(group);
      this.groups.set(group.id, group);
    }
  }

  /**
   * Clear all route groups
   */
  clear(): void {
    this.groups.clear();
  }

  /**
   * Get the count of route groups
   */
  get count(): number {
    return this.groups.size;
  }
}
