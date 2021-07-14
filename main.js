const fs = require('fs');
const path = require('path');
const util = require('util');
const pdfparse = require('pdf-parse');
const markdownpdf = require('markdown-pdf');

const date = new Date();
const current = {
  date: date,
  month: (date.getMonth() + 1).toString().padStart(2, "0"),
  year: date.getFullYear().toString()
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

  const result = [
    `**Stanarina i režije ${current.month}/${current.year}**`,
    '---',
  ];

  const dir = path.join('/home/igor/_private/stan', `${current.month}${current.year}`);
  var files = await fs.promises.readdir(dir);
  const renames = {};

  for (let i = 0; i < files.length; i++) {

    const filename = files[i];
    if (filename.endsWith('.pdf')) {

      const fullpath = path.join(dir, filename);
      const buffer = await fs.promises.readFile(fullpath);
      const data = await pdfparse(buffer);
      const lines = data.text.split('\n').filter(x => {
        return ![ '' ].includes(x);
      });

      if (lines[0] == 'Privredna banka Zagreb d.d.') {

        console.log(`Processing ${filename}`);

        const primatelj = get(lines, 'PRIMATELJAdresa primatelja', 1);
        const sifra = get(lines, 'Šifra namjeneOpis plaćanja', 1);
        const opis = get(lines, 'Šifra namjeneOpis plaćanja', 2);
        const cijena = get(lines, 'IZNOSNaknada', 1).replace('HRK', 'kn').replace('.', ',');
        const vrijeme = get(lines, 'StatusDatum i vrijeme potvrde', 2);
      
        if (primatelj.includes('ZAGREBAČKI HOLDING') && sifra == '-' && opis.includes('NAKNADE I USLUGE ZA ')) {
          const title = parseFloat(cijena) < 30 ? 'Mala pričuva' : 'Holding';
          const date = opis.replace('NAKNADE I USLUGE ZA ', '');
          const month = date.split('/')[0];
          const year = date.split('/')[1];
          result.push(`${title} ${month}/${year} = ${cijena}`);
          renames[filename] = `${title.toLowerCase().replace(' ', '_').replace('č', 'c')}_${month}${year}.pdf`;
        }
        else if (primatelj.includes('ZAGREBAČKI HOLDING') && sifra == '-' && opis.includes('KN ')) {
          const date = opis.replace('KN ', '');
          const month = date.split('/')[0];
          const year = date.split('/')[1];
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
          const month = date.substring(4, 6);
          const year = date.substring(0, 4);
          result.push(`Struja ${month}/${year} = ${cijena}`);
          renames[filename] = `struja_${month}${year}.pdf`;
        }
        else if (primatelj.includes('HEP ELEKTRA') && sifra == 'ELEC' && opis.includes('Račun za:')) {
          const dates = opis.replace('Račun za:', '').split('-');
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
  result.push(`Stanarina ${current.month}/${current.year} = 2300 kn`);

  console.log(result.join('\n'));
  console.log('Generating PDF...');
  const to = markdownpdf().from.string(result.join('\n\n')).to;
  const generate = util.promisify(to);
  await generate(path.join(dir, `stanarina_${current.month}${current.year}.pdf`));
  console.log('Done.');

  for (let old in renames) {
    const name = renames[old];
    const p1 = path.join(dir, old);
    const p2 = path.join(dir, name);
    console.log(`Renaming ${old} -> ${name}`);
    await fs.promises.rename(p1, p2);
  }
}

main();