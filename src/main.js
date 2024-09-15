const fs = require('node:fs');
const path = require('node:path');
const util = require('node:util');
const readline = require('node:readline');

const pdfparse = require('pdf-parse');
const nodemailer = require('nodemailer');
const puppeteer = require('puppeteer-core');

const config = require('./config').get();

const color = (colorCode, text) => {
  return `\x1b[${colorCode}m${text}\x1b[0m`;
};

const error = (text) => {
  console.log(color(91, text));
  process.exit(1);
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});
const question = util.promisify(rl.question).bind(rl);

const usage = () => {
  console.log('rezije 1.1\n\nusage example: rezije 052023');
  process.exit(1);
};

const arg = process.argv[2];
if (!arg || arg.length !== 6) {
  usage();
};

const current = {
  month: arg.substring(0, 2),
  year: arg.substring(2, 6)
};

const cyi = parseInt(current.year);
const cmi = parseInt(current.month);
if (cyi < 2021 || cyi > 2100 || cmi < 1 || cmi > 12) {
  usage();
};

const get = (lines, key, offset) => {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line == key) {
      return lines[i + offset];
    }
  }
  return null;
};

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
  
  const html = {
    p: (text) => `<p>${text}</p>`,
    bold: (text) => `<strong>${text}</strong>`,
    hr: () => '<hr>'
  };

  const now = new Date();
  const result = [
    html.p(html.bold(`Stanarina i režije ${current.month}/${current.year}`)),
    html.p(html.bold(`${now.toLocaleString('hr-HR', { timeZone: "Europe/Zagreb" }).replace('. ', '.').replace('. ', '.')}`)),
    html.hr(),
  ];

  const dir = path.join(config.directory, `${current.month}${current.year}`);

  let files = null;
  try {
    files = await readDirSorted(dir);
  } catch (e) {
    console.log(e.message);
    process.exit(1);
  }
  
  const renames = [];
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
        let newFilename = null;
      
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
          result.push(html.p(`${title} ${month}/${year} = ${cijena}`));
          newFilename = `${title.toLowerCase().replace(' ', '_').replace('č', 'c')}_${month}${year}.pdf`;
        }
        else if (primatelj.includes('ZAGREBAČKI HOLDING') && sifra == '-' && (opis.includes('KN ') || opis.includes('KN,NUV '))) {
          const date = opis.replace('KN ', '').replace('KN,NUV ', '');
          const month = `${date.substring(0, 2)}-${date.substring(3, 5)}`;
          const year = date.slice(-2);
          result.push(html.p(`Komunalna naknada ${month}/20${year} = ${cijena}`));
          newFilename = `komunalna_naknada_${month}20${year}.pdf`;
        }
        else if (primatelj.includes('GRADSKA PLINARA') && sifra == 'GASB' && opis.includes('Akontacijska rata za ')) {
          const date = opis.replace('Akontacijska rata za ', '');
          const month = date.split('.')[0];
          const year = date.split('.')[1].replace('.', '');
          result.push(html.p(`Plin ${month}/${year} = ${cijena}`));
          newFilename = `plin_${month}${year}.pdf`;
        }
        else if (primatelj.includes('GRADSKA PLINARA') && sifra == 'GASB' && opis.includes('Obračun plina za ')) {
          const num = opis.replace('Obračun plina za ', '');
          result.push(html.p(`Plin obračun ${num} = ${cijena}`));
          newFilename = `plin_obracun_${num}.pdf`;
        }
        else if (primatelj.includes('HEP ELEKTRA') && sifra == 'ELEC' &&
          (opis.includes('Mjesecna novcana obveza za ') || 
           opis.includes('Mjesečna novčana obveza za ') ||
           opis.includes('Akontacija') ||
           opis.includes('MNO'))
        ) {
          const pnb = get(lines, 'MODEL I POZIV NA BROJ PRIMATELJABanka primatelja', 1);
          const month = pnb.substring(18, 20);
          const year = `20${pnb.substring(16, 18)}`;
          result.push(html.p(`Struja ${month}/${year} = ${cijena}`));
          newFilename = `struja_${month}${year}.pdf`;
        }
        else if (primatelj.includes('HEP ELEKTRA') && sifra == 'ELEC' && (opis.includes('Račun za:') || opis.includes('Racun za:'))) {
          const dates = opis.replace('Račun za:', '').replace('Racun za:', '').split('-');
          const month = dates[1].substring(2, 4);
          const year = dates[1].substring(4, 8);
          result.push(html.p(`Struja obračun ${month}/${year} = ${cijena}`));
          newFilename = `struja_obracun_${month}${year}.pdf`;
        }
        else if (primatelj.includes('VODOOPSKRBA I ODVODNJA') && sifra == 'WTER' && opis.includes('RAČUN BROJ ')) {
          const id = parseInt(opis.replace('RAČUN BROJ ', ''));
          const vrijeme = get(lines, 'StatusDatum i vrijeme potvrde', 2);
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
            index: result.length
          });
          // placeholder to keep results in order
          // result item and newFilename will be determined later based on number of waters
          result.push(null);
          newFilename = null;
        }
        else {
          error(`unrecognized pdf: ${filename}`);
        }
        renames.push({ oldName: filename, newName: newFilename });
      }
    }
  }

  // ----------------------- water logic -----------------------
  // trying to guess the month since that information is not in the pdf
  if (waters.length > 0) {
    
    // order from newest to oldest by invoice id
    waters.sort((a, b) => {
      return b.id - a.id;
    });
    
    // payment date of most recent water
    const waterDate = new Date(waters[0].date);
    
    // if paid during beginning of the month, water is not for the previous month but the one before that
    if (waterDate.getDate() <= 5) {
      waterDate.setDate(0);
    }
    // set to the end day of the last month
    waterDate.setDate(0);
    
    // process waters from newest to oldest, moving back one month at a time
    for (let i = 0; i < waters.length; i++) {
      
      const water = waters[i];
      const month = (waterDate.getMonth() + 1).toString().padStart(2, "0");
      const year = waterDate.getFullYear().toString();
  
      // set to original position
      result[water.index] = html.p(`Voda ${month}/${year} = ${water.price}`);
      const waterRename = renames.find(x => x.oldName === water.filename);
      waterRename.newName = `voda_${month}${year}.pdf`;
      
      // go to previous month
      waterDate.setDate(0);
    }
  }
  // ----------------------- end water logic -----------------------
  
  if (renames.length === 0) {
    error('No files found.');
  }

  //result.push(html.hr());
  //result.push(html.p(`Stanarina ${current.month}/${current.year} = polog`));

  console.log(color(31, result.join('\n')));
  
  process.stdout.write('Generating PDF... ');
  const css = 'font-family: Roboto; font-size: 16px;';
  const final = `<html><body style="${css}">${result.join('')}</body></html>`;

  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium-browser',
    headless: 'shell'
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

  const stanarina = path.join(dir, `rezije_${current.month}${current.year}.pdf`);
  await fs.promises.writeFile(stanarina, pdf);
  console.log('done.');
  
  for (let i = 0; i < renames.length; i++) {
    const rn = renames[i];
    const p1 = path.join(dir, rn.oldName);
    const p2 = path.join(dir, rn.newName);
    console.log(`Renaming: ${rn.oldName} -> ${rn.newName}`);
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
    console.log(color(34, atts[i]));
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
    console.log(color(32, `Message sent to ${config.to.name} <${config.to.address}>\n${info.messageId}`));
  }
};

main();