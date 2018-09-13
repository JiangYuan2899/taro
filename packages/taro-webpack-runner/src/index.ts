import chalk from 'chalk';
import { merge } from 'lodash';
import * as opn from 'opn';
import * as ora from 'ora';
import * as path from 'path';
import * as webpack from 'webpack';
import * as WebpackDevServer from 'webpack-dev-server';

import buildConf from './config/build.conf';
import devConf from './config/dev.conf';
import devServerConf from './config/devServer.conf';
import prodConf from './config/prod.conf';
import { prepareUrls } from './util';
import formatWebpackMessage from './util/format_webpack_message';
import { BuildConfig } from './util/types';

const appPath = process.cwd()
let isFirst = true

const getServeSpinner = (() => {
  let spinner
  return () => {
    if (!spinner) spinner = ora(`Starting development server, please wait~`)
    return spinner
  }
})()

const printBuildError = (err: Error): void => {
  const message = err != null && err.message
  const stack = err != null && err.stack
  if (stack && typeof message === 'string' && message.indexOf('from UglifyJs') !== -1) {
    try {
      const matched = /(.+)\[(.+):(.+),(.+)\]\[.+\]/.exec(stack)
      if (!matched) {
        throw new Error('Using errors for control flow is bad.')
      }
      const problemPath = matched[2]
      const line = matched[3]
      const column = matched[4]
      console.log('Failed to minify the code from this file: \n\n', chalk.yellow(`\t${problemPath}:${line}${column !== '0' ? ':' + column : ''}`), '\n')
    } catch (ignored) {
      console.log('Failed to minify the bundle.', err)
    }
  } else {
    console.log((message || err) + '\n')
  }
  console.log()
}

const createCompiler = (webpackConf): webpack.Compiler => {
  const compiler = webpack(webpackConf)
  compiler.hooks.invalid.tap('taroInvalid', filepath => {
    // console.log(chalk.grey(`[${formatTime()}]Modified: ${filepath}`))
    getServeSpinner().text = 'Compiling...'
    getServeSpinner().render()
  })
  compiler.hooks.done.tap('taroDone', stats => {
    const { errors, warnings } = formatWebpackMessage(stats.toJson(true))
    const isSuccess = !errors.length && !warnings.length
    if (isSuccess) {
      getServeSpinner().stopAndPersist({
        symbol: '✅ ',
        text: chalk.green('Compile successfully!\n')
      })
    }
    if (errors.length) {
      errors.splice(1)
      getServeSpinner().stopAndPersist({
        symbol: '🙅  ',
        text: chalk.red('Compile failed!\n')
      })
      console.log(errors.join('\n\n') + '\n')
    }
    if (warnings.length) {
      warnings.splice(1)
      getServeSpinner().stopAndPersist({
        symbol: '⚠️  ',
        text: chalk.yellow('Compile completes with warnings.\n')
      })
      console.log(warnings.join('\n\n') + '\n')
    }
  })
  return compiler
}

const buildProd = (config: BuildConfig): void => {
  const webpackChain = prodConf(config)

  if (config.webpackChain instanceof Function) {
    config.webpackChain(webpackChain, webpack)
  }

  const webpackConfig = webpackChain.toConfig()
  const compiler = webpack(webpackConfig)

  getServeSpinner().text = 'Compiling...'
  getServeSpinner().start()

  compiler.run((err, stats) => {
    if (err) {
      return printBuildError(err)
    }

    const { errors, warnings } = formatWebpackMessage(stats.toJson({}))
    const isSuccess = !errors.length && !warnings.length
    if (isSuccess) {
      getServeSpinner().stopAndPersist({
        symbol: '✅ ',
        text: chalk.green('Compile successfully!\n')
      })
      return process.stdout.write(
        stats.toString({
          colors: true,
          modules: false,
          children: false,
          chunks: false,
          chunkModules: false
        }) + '\n'
      )
    }
    if (errors.length) {
      errors.splice(1)
      getServeSpinner().stopAndPersist({
        symbol: '🙅  ',
        text: chalk.red('Compile failed!\n')
      })
      return printBuildError(new Error(errors.join('\n\n')))
    }
    if (warnings.length) {
      getServeSpinner().stopAndPersist({
        symbol: '⚠️  ',
        text: chalk.yellow('Compile completes with warnings.\n')
      })
      console.log(warnings.join('\n\n'))
      console.log('\nSearch for the ' + chalk.underline(chalk.yellow('keywords')) + ' to learn more about each warning.')
      console.log('To ignore, add ' + chalk.cyan('// eslint-disable-next-line') + ' to the line before.\n')
    }
  })
}

const buildDev = (config: BuildConfig): void => {
  const conf = buildConf(config)
  const publicPath = conf.publicPath
  const outputPath = path.join(appPath, conf.outputRoot)
  const customDevServerOptions = config.devServer || {}
  const https = 'https' in customDevServerOptions ? customDevServerOptions.https : conf.https
  const host = customDevServerOptions.host || conf.host
  const port = customDevServerOptions.port || conf.port
  const urls = prepareUrls(https ? 'https' : 'http', host, port)

  const webpackChain = devConf(config)

  if (config.webpackChain instanceof Function) {
    config.webpackChain(webpackChain, webpack)
  }
  const webpackConfig = webpackChain.toConfig()

  const baseDevServerOptions = devServerConf({
    publicPath,
    contentBase: outputPath,
    https,
    host,
    public: urls.lanUrlForConfig
  })
  const devServerOptions = merge({}, baseDevServerOptions, customDevServerOptions)
  WebpackDevServer.addDevServerEntrypoints(webpackConfig, devServerOptions)
  const compiler = createCompiler(webpackConfig)
  compiler.hooks.done.tap('taroDoneFirst', stats => {
    if (isFirst) {
      isFirst = false
      getServeSpinner().clear()
      console.log()
      console.log(chalk.cyan(`ℹ️  Listening at ${urls.lanUrlForTerminal}`))
      console.log(chalk.cyan(`ℹ️  Listening at ${urls.localUrlForBrowser}`))
      console.log(chalk.gray('\n监听文件修改中...\n'))
    }
  })
  const server = new WebpackDevServer(compiler, devServerOptions)
  console.log()
  getServeSpinner().text = 'Compiling...'
  getServeSpinner().start()

  server.listen(port, host, err => {
    if (err) return console.log(err)
    opn(urls.localUrlForBrowser)
  })
}

export default (config: BuildConfig): void => {
  if (config.isWatch) {
    buildDev(config)
  } else {
    buildProd(config)
  }
}
