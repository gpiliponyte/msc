#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const exec = require("child_process").exec;
const chalk = require("chalk");
const util = require("util");
const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);
const execP = util.promisify(require("child_process").exec);
const inquirer = require("inquirer");
const Rx = require("rxjs");
const RxOp = require("rxjs/operators");
const convert = require("xml-js");

const cwd = process.cwd();
const currentFolder = cwd.split("/")[cwd.split("/").length - 1];
const wrap = (raw, n) => raw.match(new RegExp(`.{1,${n}}`, 'g')).join('\n');

const options = {
    compact: true,
    ignoreComment: true,
    spaces: 4
};

let selectedToUpdateModule;
let selectedVersion;
let oldFile, newFile, updatedFile;

console.group();
console.log(
  chalk.hex('#009B9A')(`\n\nYou are checking microservice compatibility for this project:`),
  chalk.hex('#FFA902')(`${currentFolder}`)
);
console.log(
  chalk.hex('#FFA902')(`* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *\n\n`)
);
console.log(`Current project composition: \n\n`);

readFile(path.resolve(cwd, "pom.xml")).then(data => {
  const regexToGetChildModules = /<module>[^<]+<\/module>/g;
  const childModules = data
    .toString()
    .match(regexToGetChildModules)
    .map(m => m.slice(8, m.length - 9));

  Rx.combineLatest(
    childModules.map(m =>
      Rx.from(readFile(path.resolve(`${cwd}/${m}`, "pom.xml")))
    )
  )
    .pipe(
      RxOp.tap(modules => {
        modules.forEach((mod, i) => {
          const version = convert.xml2js(mod.toString(), options).project.version['_text'];
          console.log(
            chalk.hex('#009B9A')(
              chalk.white(`${i+1}) `), `Microservice ${childModules[i]}, version: ${version}`
            )
          );
        });

        console.log('\n\n');
      }),
      RxOp.map(m =>
        Rx.from(
          inquirer.prompt([
            {
              name: "selectedModule",
              message: "Which module would you like to update?",
              type: "list",
              choices: childModules
            }
          ])
        )
      ),
      RxOp.switchMap(answers => answers),
      RxOp.switchMap(answers =>
        Rx.from(execP(`ls -d ${cwd}/*/`)).pipe(
          RxOp.map(s => {
            selectedToUpdateModule = answers.selectedModule;
            return s.stdout
              .split("\n")
              .map(path => {
                const dirs = path.split("/");
                return dirs[dirs.length - 2];
              })
              .filter(
                mod => !!mod && mod.includes(selectedToUpdateModule) && mod.length > selectedToUpdateModule.length
              );
          })
        )
      ),
      RxOp.tap(availableVersions => {
          if (availableVersions.length === 0) {
              console.log("No versions for updating available, sorry!");
          }
      }),
      RxOp.filter(availableVersions => availableVersions.length > 0),
      RxOp.map(availableVersions => {
        return Rx.from(
              inquirer.prompt([
                {
                  name: "selectedVersion",
                  message: "Which version would you like to update to?",
                  type: "list",
                  choices: availableVersions
                }
              ])
            )
      }),
      RxOp.switchMap(versionAnswer => {
        return versionAnswer.pipe(
          RxOp.map(answer => {
              selectedVersion = answer.selectedVersion;
            return Rx.combineLatest([
              Rx.from(readFile(path.resolve(`${cwd}/${selectedToUpdateModule}`, "pom.xml"))),
              Rx.from(
                readFile(path.resolve(`${cwd}/${answer.selectedVersion}`, "pom.xml"))
              )
            ])}
          )
        );
      }),
      RxOp.tap(oldAndNewPOMFiles => {
        oldAndNewPOMFiles.subscribe(files => {

          oldFile = convert.xml2js(files[0].toString(), options);
          newFile = convert.xml2js(files[1].toString(), options);

          updatedFile = {
            ...oldFile,
            project: {
              ...oldFile.project,
              version: newFile.project.version,
              dependencies: newFile.project.dependencies
            }
          };

          writeFile(
            path.resolve(`${cwd}/${selectedToUpdateModule}`, "pom.xml"),
            convert.js2xml(updatedFile, options)
          )
            .then(() => {
              exec(`cd ${cwd} && mvn package -e`, (e, s, err) => {

                  console.log('\n\n');

                  if (e) {
                      const errors = s.match(/Could not resolve dependencies for project[^\n]+[\n]/g);
                      const cyclicErrors = s.match(/The projects in the reactor contain a cyclic reference[^\n]+[\n]/g);
                      if (!!errors && errors.length > 0) {
                          const error = errors[errors.length - 1].slice(0, -1);
                          console.log('Microservice', chalk.hex('#009B9A')(`${selectedToUpdateModule}`), `cannot be updated from version`, chalk.hex('#FF913A')(`${oldFile.project.version['_text']}`), `to`, chalk.hex('#FF913A')(`${newFile.project.version['_text']}`));
                          console.log('Due to error:');
                          console.log(chalk.hex('#C85900')(wrap(error, 70)), '\n');
                      }
                      if (!!cyclicErrors && cyclicErrors.length > 0) {
                          const error = cyclicErrors[cyclicErrors.length - 1].slice(0, -1);
                          console.log('Microservice', chalk.hex('#009B9A')(`${selectedToUpdateModule}`), `cannot be updated from version`, chalk.hex('#FF913A')(`${oldFile.project.version['_text']}`), `to`, chalk.hex('#FF913A')(`${newFile.project.version['_text']}`));
                          console.log('Due to error:');
                          console.log(chalk.hex('#C85900')(wrap(error, 70)), '\n');
                      }
                  } else {
                      console.log(chalk.hex('#ffffff')(
                           `Microservice`, chalk.hex('#009B9A')(`${selectedToUpdateModule}`), `is safe to update from version`, chalk.hex('#009B9A')(`${oldFile.project.version['_text']}`), `to` ,chalk.hex('#009B9A')(`${newFile.project.version['_text']}\n`)
                      ));
                  }

                  writeFile(
                    path.resolve(`${cwd}/${selectedToUpdateModule}`, "pom.xml"),
                    convert.js2xml(oldFile, options)
                  );

                  console.groupEnd();
              });
            })
        });
      })
    )
    .subscribe(() => {
    });
});
