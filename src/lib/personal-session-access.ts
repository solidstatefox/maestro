import type { PersonalAuthSession } from "@/lib/personal-auth";
/** One Canvas access decision for History, Bookmarks, policy, and future Personal features.
 * Do not mount Personal UI or start Personal requests until restoration is complete.
 * Every proxy Personal endpoint independently enforces requirePersonalLogin(). */
export function canUsePersonalStore(session: PersonalAuthSession | null, restored: boolean): boolean {
  return restored && Boolean(session?.graphStore && session?.graphPrefix && session?.authHeader);
}
