const fs = require('fs');
const path = require('path');
const util = require('util');
const pdfparse = require('pdf-parse');
const nodemailer = require('nodemailer');
const puppeteer = require('puppeteer-core');
const marked = require('marked');
const chalk = require('chalk');
const config = require('./config.json');

const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});
const question = util.promisify(rl.question).bind(rl);

marked.marked.use({
  mangle: false,
  headerIds: false,
  async: true
});

const usage = () => {
  console.log('rezije 1.1\n\nusage example: rezije 052023');
  process.exit(1);
}

const arg = process.argv[2];
if (!arg || arg.length != 6) {
  usage();
}

const current = {
  month: arg.substring(0, 2),
  year: arg.substring(2, 6)
}

const cyi = parseInt(current.year);
const cmi = parseInt(current.month);
if (cyi < 2021 || cyi > 2100 || cmi < 1 || cmi > 12) {
  usage();
}

const get = (lines, key, offset) => {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line == key) {
      return lines[i + offset];
    }
  }
  return null;
}

const main = async () => {

  const now = new Date();
  const result = [
    `**Stanarina i režije ${current.month}/${current.year}**`,
    `**${now.toLocaleString('hr-HR').replace('. ', '.').replace('. ', '.')}**`,
    '---',
  ];

  const dir = path.join(config.directory, `${current.month}${current.year}`);

  let files = null;
  try {
    files = await fs.promises.readdir(dir);
  } catch (e) {
    console.log(e.message);
    process.exit(1);
  }
  
  const renames = {};

  for (let i = 0; i < files.length; i++) {

    const filename = files[i];
    if (filename.endsWith('.pdf')) {

      const fullpath = path.join(dir, filename);
      const buffer = await fs.promises.readFile(fullpath);
      const data = await pdfparse(buffer);
      const lines = data.text.split('\n').filter(x => x);

      if (lines[0] == 'Privredna banka Zagreb d.d.') {

        console.log(`Processing: ${filename}`);

        const primatelj = get(lines, 'PRIMATELJAdresa primatelja', 1);
        const sifra = get(lines, 'Šifra namjeneOpis plaćanja', 1);
        const opis = get(lines, 'Šifra namjeneOpis plaćanja', 2);
        const cijena = get(lines, 'IZNOSNaknada', 1).replace('HRK', 'kn').replace('EUR', '€').replace('.', ',');
        const vrijeme = get(lines, 'StatusDatum i vrijeme potvrde', 2);
      
        if (primatelj.includes('ZAGREBAČKI HOLDING') && sifra == '-' && opis.includes('NAKNADE I USLUGE ZA ')) {
          const title = parseFloat(cijena) < 5 ? 'Mala pričuva' : 'Holding';
          const date = opis.replace('NAKNADE I USLUGE ZA ', '');
          let month = null;
          let year = null;
          if (date.includes('/')) {
            month = date.split('/')[0];
            year = date.split('/')[1];
          } else if (date.length == 6) {
            month = date.substring(0, 2);
            year = date.substring(2, 6);
          } else {
            throw new Error(`can't parse date: ${date}`);
          }
          result.push(`${title} ${month}/${year} = ${cijena}`);
          renames[filename] = `${title.toLowerCase().replace(' ', '_').replace('č', 'c')}_${month}${year}.pdf`;
        }
        else if (primatelj.includes('ZAGREBAČKI HOLDING') && sifra == '-' && (opis.includes('KN ') || opis.includes('KN,NUV '))) {
          const date = opis.replace('KN ', '').replace('KN,NUV ', '');
          const month = `${date.substring(0, 2)}-${date.substring(3, 5)}`;
          const year = date.slice(-2);
          result.push(`Komunalna naknada ${month}/20${year} = ${cijena}`);
          renames[filename] = `komunalna_naknada_${month}20${year}.pdf`;
        }
        else if (primatelj.includes('GRADSKA PLINARA') && sifra == 'GASB' && opis.includes('Akontacijska rata za ')) {
          const date = opis.replace('Akontacijska rata za ', '');
          const month = date.split('.')[0];
          const year = date.split('.')[1].replace('.', '');
          result.push(`Plin ${month}/${year} = ${cijena}`);
          renames[filename] = `plin_${month}${year}.pdf`;
        }
        else if (primatelj.includes('GRADSKA PLINARA') && sifra == 'GASB' && opis.includes('Obračun plina za ')) {
          const num = opis.replace('Obračun plina za ', '');
          result.push(`Plin obračun ${num} = ${cijena}`);
          renames[filename] = `plin_obracun_${num}.pdf`;
        }
        else if (primatelj.includes('HEP ELEKTRA') && sifra == 'ELEC' && opis.includes('Mjesecna novcana obveza za ')) {
          const date = opis.replace('Mjesecna novcana obveza za ', '');
          const month = date.substring(0, 2);
          const year = date.substring(3, 7);
          result.push(`Struja ${month}/${year} = ${cijena}`);
          renames[filename] = `struja_${month}${year}.pdf`;
        }
        else if (primatelj.includes('HEP ELEKTRA') && sifra == 'ELEC' && (opis.includes('Račun za:') || opis.includes('Racun za:'))) {
          const dates = opis.replace('Račun za:', '').replace('Racun za:', '').split('-');
          const month = dates[1].substring(2, 4);
          const year = dates[1].substring(4, 8);
          result.push(`Struja obračun ${month}/${year} = ${cijena}`);
          renames[filename] = `struja_obracun_${month}${year}.pdf`;
        }
        else if (primatelj.includes('VODOOPSKRBA I ODVODNJA') && sifra == 'WTER' && opis.includes('RAČUN BROJ ')) {
          const split = vrijeme.split('.');
          const d = parseInt(split[0]);
          const m = parseInt(split[1]);
          const y = parseInt(split[2]);
          const previous = new Date(y, m - 1, d);
          previous.setDate(0);
          if (d <= 5) {
            previous.setDate(0); // pred pocetak mjeseca
          }
          const month = (previous.getMonth() + 1).toString().padStart(2, "0");
          const year = previous.getFullYear().toString();
          result.push(`Voda ${month}/${year} = ${cijena}`);
          renames[filename] = `voda_${month}${year}.pdf`;
        }
        else {
          throw new Error(`unrecognized pdf: ${filename}`);
        }

      }
    }
  }

  result.push('---');
  result.push(`Stanarina ${current.month}/${current.year} = 305 €`);

  console.log(chalk.red(result.join('\n')));
  
  process.stdout.write('Generating PDF... ');
  const parsed = await marked.marked.parse(result.join('\n\n'));
  const html = parsed.replaceAll('\n', '');
  const css = 'font-family: Roboto; font-size: 16px;';
  const final = `<html><body style="${css}">${html}</body></html>`;

  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium-browser',
    headless: true
  });
  const page = await browser.newPage();
  await page.setContent(final);
  const pdf = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: {
      top: 75,
      bottom: 75,
      left: 75,
      right: 75
    }
  });
  await browser.close();

  const stanarina = path.join(dir, `stanarina_${current.month}${current.year}.pdf`);
  await fs.promises.writeFile(stanarina, pdf);
  console.log('done.');

  for (let old in renames) {
    const name = renames[old];
    const p1 = path.join(dir, old);
    const p2 = path.join(dir, name);
    console.log(`Renaming: ${old} -> ${name}`);
    await fs.promises.rename(p1, p2);
    fs.rename(p1, p2);
  }

  const atts = await fs.promises.readdir(dir);
  const attachments = [];
  for (let i = 0; i < atts.length; i++) {
    attachments.push({
      filename: atts[i],
      path: path.join(dir, atts[i])
    });
    console.log(chalk.blue(atts[i]));
  }

  const mail = {
    from: config.from,
    to: config.to,
    subject: `Stanarina i režije ${current.month}/${current.year}`,
    text: 'Potvrde u prilogu.\n\nPozdrav, Igor'
  };
  console.log(mail);
  const answer = await question('Send this email? [y/N] ');
  rl.close();

  if (answer.trim().toLowerCase() === 'y') {
    const transport = {
      host: 'smtp.office365.com',
      port: 587,
      secure: false,
      auth: {
        user: config.username,
        pass: config.password,
      },
      tls: {
        ciphers: 'SSLv3'
      }
    };
    const transporter = nodemailer.createTransport(transport);
    mail.attachments = attachments;
    const info = await transporter.sendMail(mail);
    console.log(chalk.red(`Message sent to ${config.to}\n${info.messageId}`));
  }
}

main();