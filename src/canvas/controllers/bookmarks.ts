"use client";

import { useRef, useState } from "react";

/** State owned by the bookmarks subsystem. Query-tree mutations still use the authoritative FCT store. */
export function useBookmarksState() {
  const [shareLinkCopied, setShareLinkCopied] = useState(false);
  const [bookmarkDialogOpen, setBookmarkDialogOpen] = useState(false);
  const [bookmarkTitle, setBookmarkTitle] = useState("");
  const [bookmarkDescription, setBookmarkDescription] = useState("");
  const [bookmarkTags, setBookmarkTags] = useState("");
  const [bookmarkTagVocabulary, setBookmarkTagVocabulary] = useState<"skos" | "dcterms" | "scot">("skos");
  const [bookmarkSaving, setBookmarkSaving] = useState(false);
  const [isQueryBookmarked, setIsQueryBookmarked] = useState(false);
  const [matchingBookmarkId, setMatchingBookmarkId] = useState("");
  const [bookmarkCheckRevision, setBookmarkCheckRevision] = useState(0);
  const [historyBookmarkId, setHistoryBookmarkId] = useState("");
  const bookmarkTitleInputRef = useRef<HTMLInputElement>(null);
  const [isExportingBookmarks, setIsExportingBookmarks] = useState(false);
  const [isImportingBookmarks, setIsImportingBookmarks] = useState(false);
  const bookmarkImportFileRef = useRef<HTMLInputElement | null>(null);

  return {
    shareLinkCopied,
    setShareLinkCopied,
    bookmarkDialogOpen,
    setBookmarkDialogOpen,
    bookmarkTitle,
    setBookmarkTitle,
    bookmarkDescription,
    setBookmarkDescription,
    bookmarkTags,
    setBookmarkTags,
    bookmarkTagVocabulary,
    setBookmarkTagVocabulary,
    bookmarkSaving,
    setBookmarkSaving,
    isQueryBookmarked,
    setIsQueryBookmarked,
    matchingBookmarkId,
    setMatchingBookmarkId,
    bookmarkCheckRevision,
    setBookmarkCheckRevision,
    historyBookmarkId,
    setHistoryBookmarkId,
    bookmarkTitleInputRef,
    isExportingBookmarks,
    setIsExportingBookmarks,
    isImportingBookmarks,
    setIsImportingBookmarks,
    bookmarkImportFileRef,
  };
}
