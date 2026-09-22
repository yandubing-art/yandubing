declare module "mailparser" {
  type ParsedAttachment = {
    filename?: string | null;
    contentType?: string;
    content: Buffer;
  };

  type ParsedMail = {
    attachments: ParsedAttachment[];
  };

  export function simpleParser(source: Buffer | Uint8Array): Promise<ParsedMail>;
}
