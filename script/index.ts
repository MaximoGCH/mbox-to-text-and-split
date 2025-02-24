import fs from "fs";
import { MboxStream } from "node-mbox";
import { AddressObject, simpleParser, Source } from "mailparser";
import {
  bufferCount,
  catchError,
  concatMap,
  EMPTY,
  finalize,
  from,
  map,
  Subject,
  tap,
  toArray,
} from "rxjs";
import { config } from "./config";

const extractEmails = async (mboxFilePath) => {
  console.log("START READING MAILS...");
  const mailbox = fs.createReadStream(mboxFilePath);
  const mbox = MboxStream(mailbox, {});

  const importedFiles$ = new Subject<Source>();
  let batchNumber = 0;
  let processNumber = 0;
  let mailIdNumber = 0;

  if (!fs.existsSync(`${config.resultPath}`)) {
    fs.mkdirSync(`${config.resultPath}`);
  }

  importedFiles$
    .pipe(
      bufferCount(config.groupedMessagesNumber),
      concatMap((arr) =>
        from(arr).pipe(
          concatMap((buffer: Source) => {
            return from(simpleParser(buffer));
          }),
          map((mail) => {
            const mailId = `mail-${mailIdNumber++}`;

            return {
              text: Object.entries({
                messageId: mail.messageId,
                references: possibleStringArrayToString(mail.references),
                from: addressObjectToString(mail.from),
                to: addressObjectToString(mail.to),
                cc: addressObjectToString(mail.cc),
                bcc: addressObjectToString(mail.bcc),
                replyTo: addressObjectToString(mail.replyTo),
                inReplyTo: mail.inReplyTo,
                priority: mail.priority,
                date: mail.date?.toISOString(),
                subject: mail.subject,
                data: mail.text,
                attachments: mail.attachments
                  .map((attachment) =>
                    createValidFilename(`${mailId}-${attachment.filename}`)
                  )
                  .join(", "),
              })
                .filter(([, body]) => !!body && body.length)
                .map((entry) => entry.join(": "))
                .join("\r\n"),
              attachments: mail.attachments.map((attachment) => ({
                ...attachment,
                filename: createValidFilename(
                  `${mailId}-${attachment.filename}`
                ),
              })),
            };
          }),
          catchError((e) => {
            console.error("ERROR READING THE MESSAGE", e);
            return EMPTY;
          }),
          tap(() => {
            processNumber++;
            console.log(`We have read: ${processNumber} mails...`);
          }),
          toArray()
        )
      ),
      finalize(() => {
        console.log("The process has finished");
      })
    )
    .subscribe((messages) => {
      batchNumber++;

      const dir = `${config.resultPath}/messages-${batchNumber}`;
      const attachmentDir = `${dir}/attachments`;
      console.log(`Creating output ${dir}...`);

      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
      }

      if (!fs.existsSync(attachmentDir)) {
        fs.mkdirSync(attachmentDir);
      }

      console.log(`Writing text file...`);
      const batchText = messages
        .map((msg) => msg.text)
        .join("\r\n----------------End of the mail----------------\r\n");
      fs.writeFileSync(`${dir}/messages.txt`, batchText);

      console.log(`Writing attachments...`);
      const allAttachments = messages.map((msg) => msg.attachments).flat();
      for (const attachment of allAttachments) {
        try {
          fs.writeFileSync(
            `${attachmentDir}/${attachment.filename ?? generateRandomName()}`,
            attachment.content
          );
        } catch (e) {
          console.error("ERROR DOWNLOADING THE ATTACHMENT", e);
        }
      }
    });

  mbox.on("data", async function (msgBuffer) {
    importedFiles$.next(msgBuffer);
  });

  mbox.on("finish", () => {
    importedFiles$.complete();
  });
};

function addressObjectToString(
  address: AddressObject | AddressObject[] | undefined
): string | undefined {
  if (!address) {
    return undefined;
  }

  if (Array.isArray(address)) {
    return address.map(addressObjectToString).join(", ");
  }

  return address.text;
}

function possibleStringArrayToString(
  value: string | string[] | undefined
): string | undefined {
  if (!value) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value.join(", ");
  }

  return value;
}

let randomNameGeneratorN = 0;
function generateRandomName() {
  randomNameGeneratorN++;
  return `no-filename-${randomNameGeneratorN}`;
}

function createValidFilename(filename: string) {
  const splitName = filename.split(".");
  const last = splitName.pop();
  const first = splitName.join("-");
  return `${first.replace(/([^a-z0-9]+)/gi, "-")}.${last}`;
}

extractEmails(config.mboxPath);
