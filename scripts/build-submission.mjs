import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  BorderStyle,
  WidthType,
  AlignmentType,
} from 'docx';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

async function generateDocx() {
  console.log('📄 Generating TDD.docx from TDD.md...');
  const tddPath = path.join(rootDir, 'TDD.md');
  const content = fs.readFileSync(tddPath, 'utf8');

  const lines = content.split('\n');
  const children = [];

  // Top Title & Author Header
  children.push(
    new Paragraph({
      text: "Technical Design Document (TDD)",
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
    }),
    new Paragraph({
      text: "MSME Lender's Field Collections App with AI Prioritisation",
      heading: HeadingLevel.HEADING_2,
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
    }),
    new Paragraph({
      children: [
        new TextRun({ text: "Author: ", bold: true }),
        new TextRun("Nishant Chhetri"),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [
        new TextRun({ text: "GitHub Repository: ", bold: true }),
        new TextRun({
          text: "https://github.com/nishant-chhetri/msme-collections-app",
          color: "1D4ED8",
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [
        new TextRun({ text: "Live Application URL: ", bold: true }),
        new TextRun({
          text: "https://msme-collections-app.onrender.com",
          color: "1D4ED8",
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 360 },
    })
  );

  let inCodeBlock = false;
  let codeBuffer = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    // Skip the top markdown titles we already rendered cleanly
    if (line.startsWith('# Technical Design Document') ||
        line.startsWith('## MSME Lender') ||
        line.startsWith('- **Author:**') ||
        line.startsWith('- **GitHub Repository:**') ||
        line.startsWith('- **Live Demo Application:**') ||
        line.startsWith('- **Target OS Evaluation:**') ||
        line.startsWith('- **Submission Artifact:**')) {
      continue;
    }

    // Code blocks
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        // flush code block
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: codeBuffer.join('\n'),
                font: 'Courier New',
                size: 18, // 9pt
              }),
            ],
            spacing: { before: 100, after: 100 },
          })
        );
        codeBuffer = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeBuffer = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(rawLine);
      continue;
    }

    if (!line) {
      continue;
    }

    // H1 Heading
    if (line.startsWith('# ')) {
      children.push(
        new Paragraph({
          text: line.replace(/^#\s+/, ''),
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 280, after: 120 },
        })
      );
      continue;
    }

    // H2 Heading
    if (line.startsWith('## ')) {
      children.push(
        new Paragraph({
          text: line.replace(/^##\s+/, ''),
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 240, after: 100 },
        })
      );
      continue;
    }

    // H3 Heading
    if (line.startsWith('### ')) {
      children.push(
        new Paragraph({
          text: line.replace(/^###\s+/, ''),
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 200, after: 80 },
        })
      );
      continue;
    }

    // Bullet points
    if (line.startsWith('- ') || line.startsWith('* ')) {
      const cleanBullet = line.replace(/^[-*]\s+/, '');
      // Check for bold prefix e.g. **[ASSUMPTION-01]...**
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: "•  ", bold: true, color: "3B82F6" }),
            new TextRun(cleanBullet.replace(/\*\*/g, '')),
          ],
          spacing: { after: 80 },
          indent: { left: 360 },
        })
      );
      continue;
    }

    // Numbered list
    if (/^\d+\.\s+/.test(line)) {
      children.push(
        new Paragraph({
          children: [
            new TextRun(line.replace(/\*\*/g, '')),
          ],
          spacing: { after: 80 },
          indent: { left: 360 },
        })
      );
      continue;
    }

    // Standard Paragraph
    children.push(
      new Paragraph({
        children: [
          new TextRun(line.replace(/\*\*/g, '')),
        ],
        spacing: { after: 120 },
      })
    );
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  const outDocxPath = path.join(rootDir, 'TDD.docx');
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outDocxPath, buffer);
  console.log(`✅ Compiled TDD.docx successfully (${(buffer.length / 1024).toFixed(1)} KB)`);

  return outDocxPath;
}

async function createSubmissionZip() {
  console.log('📦 Bundling TDD.docx + deployment.md into submission.zip...');
  const zipPath = path.join(rootDir, 'submission.zip');

  if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
  }

  try {
    execSync(`powershell.exe -NoProfile -Command "Compress-Archive -Path '${path.join(rootDir, 'TDD.docx')}','${path.join(rootDir, 'deployment.md')}' -DestinationPath '${zipPath}' -Force"`, {
      stdio: 'inherit',
    });
    const stats = fs.statSync(zipPath);
    console.log(`✅ submission.zip created successfully (${(stats.size / 1024).toFixed(1)} KB)`);
    return zipPath;
  } catch (err) {
    console.error('Failed to create submission.zip with Compress-Archive:', err);
    throw err;
  }
}

async function main() {
  try {
    await generateDocx();
    await createSubmissionZip();
    console.log('🎉 Submission artifacts build complete.');
  } catch (error) {
    console.error('❌ Build submission error:', error);
    process.exit(1);
  }
}

main();
