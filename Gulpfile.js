'use strict';

/**
 * Dynamically defines develop/test/build/deploy tasks for the current project
 * based on metadata present in package.json.
 */
const _log = require('fancy-log');
const _colors = require('ansi-colors');

const { Project, taskBuilders } = require('@vamship/build-utils');

const project = new Project(require('./package.json'));

const projectInfo = `${_colors.cyan.bold(project.name)} (${_colors.blue(
    project.projectType
)}, ${_colors.green(project.language)})`;

_log.info(`Initializing tasks for project: ${projectInfo}`);

const builders = [
    { build: taskBuilders.clean },
    { build: taskBuilders.format },
    { build: taskBuilders.lint },
    { build: taskBuilders.build },
    { build: taskBuilders.package },
    { build: taskBuilders.package, options: { types: true } },
    { build: taskBuilders.publish },
    { build: taskBuilders.publish, options: { types: true } },

    { build: taskBuilders.test, options: { testType: 'unit' } },
    { build: taskBuilders.test, options: { testType: 'api' } },
    { build: taskBuilders.format, options: { watch: true } },
    { build: taskBuilders.lint, options: { watch: true } },
    { build: taskBuilders.build, options: { watch: true } },
    { build: taskBuilders.test, options: { testType: 'unit', watch: true } },
    { build: taskBuilders.test, options: { testType: 'api', watch: true } }
];

const tasks = builders
    .map(({ build, options }) => build(project, Object.assign({}, options)))
    .reduce((result, tasks) => result.concat(tasks), [])
    .filter((task) => !!task)
    .reduce((result, task) => {
        result[task.displayName] = task;
        return result;
    }, {});

module.exports = tasks;
