const fs = require('node:fs');
const path = require('node:path');
const util = require('node:util');
const readline = require('node:readline');

const pdfparse = require('pdf-parse');
const nodemailer = require('nodemailer');
const chalk = require('chalk');
const puppeteer = require('puppeteer-core');
const marked = require('marked');

const config = require('./config').get();

const error = (text) => {
  console.log(chalk.red(text));
  process.exit(1);
}

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
if (!arg || arg.length !== 6) {
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

const readDirSorted = async (dir) => {
  const files = await fs.promises.readdir(dir);
  const result = await Promise.all(files.map(async (x) => {
    const stats = await fs.promises.stat(path.join(dir, x));
    return {
      name: x,
      time: stats.mtime.getTime()
    };
  }));
  return result.sort((a, b) => {
    return a.time - b.time;
  }).map(x => x.name);
};

const main = async () => {

  const now = new Date();
  const result = [
    `**Stanarina i režije ${current.month}/${current.year}**`,
    `**${now.toLocaleString('hr-HR', { timeZone: "Europe/Zagreb" }).replace('. ', '.').replace('. ', '.')}**`,
    '---',
  ];

  const dir = path.join(config.directory, `${current.month}${current.year}`);

  let files = null;
  try {
    files = await readDirSorted(dir);
  } catch (e) {
    console.log(e.message);
    process.exit(1);
  }
  
  const renames = {};
  const waters = [];

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
            error(`can't parse date: ${date}`);
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
          const id = parseInt(opis.replace('RAČUN BROJ ', ''));
          const split = vrijeme.split('.');
          const d = parseInt(split[0]);
          const m = parseInt(split[1]);
          const y = parseInt(split[2]);
          const date = new Date(y, m - 1, d);
          // used in water logic below
          waters.push({
            date: date,
            price: cijena,
            id: id,
            filename: filename,
            index: i
          });
          // placeholder to keep renames object keys in order
          renames[filename] = null;
        }
        else {
          error(`unrecognized pdf: ${filename}`);
        }
      }
    }
  }

  // ----------------------- water logic -----------------------
  // trying to guess the month since that information is not in the pdf
  if (waters.length > 0) {
    
    // order from newest to oldest by invoice id
    const watersDescending = waters.slice().sort((a, b) => {
      return b.id - a.id;
    });
    
    // payment date of most recent water
    const waterDate = watersDescending[0].date;
    
    // if paid during beginning of the month, water is not for the previous month but the one before that
    if (waterDate.getDate() <= 5) {
      waterDate.setDate(0);
    }
    // set to the end day of the last month
    waterDate.setDate(0);
    
    // process waters from newest to oldest, moving back one month at a time
    const dict = {};
    for (let i = 0; i < watersDescending.length; i++) {
      
      const water = watersDescending[i];
      const month = (waterDate.getMonth() + 1).toString().padStart(2, "0");
      const year = waterDate.getFullYear().toString();
      
      dict[water.filename] = {
        label: `Voda ${month}/${year} = ${water.price}`,
        rename: `voda_${month}${year}.pdf`
      };
      
      // go to previous month
      waterDate.setDate(0);
    }
    
    // print results in the original order
    for (let i = 0; i < waters.length; i++) {
      const water = waters[i];
      const waterInfo = dict[water.filename];
      if (!waterInfo) {
        throw new Error('invalid water logic');
      }
      // +3 skips initial header rows, insert to original position (sorted by date modified)
      result.splice(water.index + 3, 0, waterInfo.label);
      renames[water.filename] = waterInfo.rename;
    }
  }
  // ----------------------- end water logic -----------------------
  
  if (Object.keys(renames).length === 0) {
    error('No files found.');
  }

  result.push('---');
  result.push(`Stanarina ${current.month}/${current.year} = 400 €`);

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

    if (p1 !== p2) {
      // fs.promises.rename sometimes doesn't work on remote systems
      await fs.promises.copyFile(p1, p2);
      await fs.promises.unlink(p1);
    }
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
    console.log(chalk.red(`Message sent to ${config.to.name} <${config.to.address}>\n${info.messageId}`));
  }
}

main();