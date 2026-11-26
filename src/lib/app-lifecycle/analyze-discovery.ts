"use client";
import { createProviderDiscoverySupervisor } from "./provider-discovery-supervisor";
import type { AnalysisProvider } from "@/lib/personal-sparql-reads";
export const createMaestroAnalyzeDiscoveryController = () => createProviderDiscoverySupervisor<AnalysisProvider>("maestro-analyze-discovery");
