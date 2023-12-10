const config = require('./config.json');
const chalk = require('chalk');
const validator = require('email-validator');

const validateEmailObject = (obj) => {
  return obj?.name && obj?.address && validator.validate(obj.address);
}

const validate = () => {
  return config?.directory &&
    config?.username &&
    config?.password &&
    validateEmailObject(config?.from) &&
    validateEmailObject(config?.to);
}

const get = () => {
  if (!validate()) {
    console.log(chalk.red('Invalid config.json'));
    process.exit(1);
  }
  return config;
}

module.exports = {
  get
};
