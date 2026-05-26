import type { Ack } from "../types/app";
import { invokeCommand } from "./core";

export type DocxReadResponse = {
  relativePath: string;
  html: string;
  warnings: string[];
};

export function readDocx(projectId: string, relativePath: string): Promise<DocxReadResponse> {
  return invokeCommand<DocxReadResponse>("docx_read", {
    input: { projectId, relativePath },
  });
}

export function writeDocx(projectId: string, relativePath: string, html: string): Promise<Ack> {
  return invokeCommand<Ack>("docx_write", {
    input: { projectId, relativePath, html },
  });
}
