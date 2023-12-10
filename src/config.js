const config = require('./config.json');
const chalk = require('chalk');
const validator = require('email-validator');

const isAddressObjectValid = (obj) => {
  return obj?.name && obj?.address && validator.validate(obj.address);
}

const isValid = () => {
  return config?.directory &&
    config?.username &&
    config?.password &&
    isAddressObjectValid(config?.from) &&
    isAddressObjectValid(config?.to);
}

const get = () => {
  if (!isValid()) {
    console.log(chalk.red('Invalid config.json'));
    process.exit(1);
  }
  return config;
}

module.exports = {
  get
};
