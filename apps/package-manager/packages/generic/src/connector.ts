import {
	ClientConnectionOptions,
	LoggerInstance,
	PackageManagerConfig,
	ProcessHandler,
	stringifyError,
	ExpectedPackage,
	literal,
	Accessor,
} from '@sofie-package-manager/api'
import { ExpectationManager, ExpectationManagerServerOptions } from '@sofie-package-manager/expectation-manager'
import { CoreHandler, CoreConfig } from './coreHandler'
import { PackageContainers, PackageManagerHandler } from './packageManager'
import chokidar from 'chokidar'
import fs from 'fs'
import { promisify } from 'util'
import path from 'path'

const fsAccess = promisify(fs.access)
const fsReadFile = promisify(fs.readFile)
const fsWriteFile = promisify(fs.writeFile)

async function fsExist(fileName: string): Promise<boolean> {
	try {
		await fsAccess(fileName)
		return true
	} catch (err) {
		if (`${err}`.includes('ENOENT')) return false
		throw err
	}
}

export interface Config {
	process: ProcessConfig
	device: DeviceConfig
	core: CoreConfig
	packageManager: PackageManagerConfig
}
export interface ProcessConfig {
	/** Will cause the Node applocation to blindly accept all certificates. Not recommenced unless in local, controlled networks. */
	unsafeSSL: boolean
	/** Paths to certificates to load, for SSL-connections */
	certificates: string[]
}
export interface DeviceConfig {
	deviceId: string
	deviceToken: string
}
export class Connector {
	private packageManagerHandler: PackageManagerHandler
	private coreHandler: CoreHandler

	private logger: LoggerInstance
	constructor(logger: LoggerInstance, private config: PackageManagerConfig, private _process: ProcessHandler) {
		this.logger = logger.category('Connector')
		this.coreHandler = new CoreHandler(this.logger, this.config.packageManager)

		const packageManagerServerOptions: ExpectationManagerServerOptions =
			config.packageManager.port !== null
				? {
						type: 'websocket',
						port: config.packageManager.port,
				  }
				: { type: 'internal' }

		const workForceConnectionOptions: ClientConnectionOptions = config.packageManager.workforceURL
			? {
					type: 'websocket',
					url: config.packageManager.workforceURL,
			  }
			: { type: 'internal' }

		this.packageManagerHandler = new PackageManagerHandler(
			this.logger,
			config.packageManager.deviceId || 'manager0',
			packageManagerServerOptions,
			config.packageManager.accessUrl || undefined,
			workForceConnectionOptions,
			config.packageManager.concurrency,
			config.packageManager.chaosMonkey
		)
	}

	public async init(): Promise<void> {
		try {
			if (!this.config.packageManager.noCore) {
				this.logger.info('Initializing Core...')
				await this.coreHandler.init(this.config, this._process)
				this.logger.info('Core initialized')
			} else {
				this.logger.info('Skipping connecting to Core...')
				this.coreHandler.setNoCore()
			}

			this.logger.info('Initializing PackageManager...')
			await this.packageManagerHandler.init(this.config, this.coreHandler)
			this.logger.info('PackageManager initialized')

			if (this.config.packageManager.watchFiles) {
				this.logger.info('Initializing file watcher...')
				await this.initFileWatcher(this.packageManagerHandler)
				this.logger.info('file watcher initialized')
			}

			this.logger.info('Initialization done')
			return
		} catch (e) {
			this.logger.error(`Error during initialization: ${stringifyError(e)}`)

			if (this.coreHandler) {
				this.coreHandler.destroy().catch(this.logger.error)
			}

			this.logger.info('Shutting down in 10 seconds!')
			setTimeout(() => {
				// eslint-disable-next-line no-process-exit
				process.exit(0)
			}, 10 * 1000)
			return
		}
	}
	/** Do a self-test. Throws if something is not working as it should */
	public checkIfWorking(): void {
		this.coreHandler.checkIfWorking()
	}

	private async initFileWatcher(packageManagerHandler: PackageManagerHandler): Promise<void> {
		const fileName = path.join(process.cwd(), './expectedPackages.json')

		if (!(await fsExist(fileName))) {
			// File does not exist, create it:
			await fsWriteFile(
				fileName,
				JSON.stringify(
					literal<{
						description: string
						packageContainers: PackageContainers
						expectedPackages: ExpectedPackage.Any[]
					}>({
						description:
							'This file is intended for debugging use. By passing the argument --watchFiles=true, the application will monitor this file as a second source of packages, so we can fiddle without going through Core',
						packageContainers: {
							source0: {
								label: 'Source 0',
								accessors: {
									local: {
										type: Accessor.AccessType.LOCAL_FOLDER,
										label: 'Local',
										folderPath: 'D:\\media\\source0',
										allowRead: true,
										allowWrite: false,
									},
								},
							},
							target0: {
								label: 'Target 0',
								accessors: {
									local: {
										type: Accessor.AccessType.LOCAL_FOLDER,
										label: 'Local',
										folderPath: 'D:\\media\\target0',
										allowRead: true,
										allowWrite: true,
									},
								},
							},
							internet: {
								label: 'The Internet',
								accessors: {
									http: {
										type: Accessor.AccessType.HTTP,
										baseUrl: '',
										allowRead: true,
										allowWrite: false,
										label: 'HTTP',
									},
								},
							},
						},
						expectedPackages: [
							{
								type: ExpectedPackage.PackageType.MEDIA_FILE,
								_id: 'test',
								contentVersionHash: 'abc1234',
								content: {
									filePath: 'amb.mp4',
								},
								version: {},
								sources: [
									{
										containerId: 'source0',
										accessors: {
											local: {
												type: Accessor.AccessType.LOCAL_FOLDER,
												filePath: 'amb.mp4',
											},
										},
									},
								],
								layers: ['target0'],
								sideEffect: {
									previewContainerId: null,
									previewPackageSettings: null,
									thumbnailContainerId: null,
									thumbnailPackageSettings: null,
								},
							},
						],
					}),
					undefined,
					2
				),
				'utf-8'
			)
		}

		const watcher = chokidar.watch(fileName, { persistent: true })

		this.logger.info(`Watching file "${fileName}"`)

		watcher
			.on('add', () => {
				triggerReloadInput()
			})
			.on('change', () => {
				triggerReloadInput()
			})
			.on('unlink', () => {
				triggerReloadInput()
			})
			.on('error', (error) => {
				this.logger.error(`Error emitter in Filewatcher: ${stringifyError(error)}`)
			})
		const triggerReloadInput = () => {
			setTimeout(() => {
				reloadInput().catch((error) => {
					this.logger.error(`Error in reloadInput: ${stringifyError(error)}`)
				})
			}, 100)
		}
		const reloadInput = async () => {
			this.logger.info(`Change detected in ${fileName}`)
			// Check that the file exists:
			if (!(await fsExist(fileName))) return

			const str = await fsReadFile(fileName, { encoding: 'utf-8' })
			const o = JSON.parse(str)

			if (o.packageContainers && o.expectedPackages) {
				packageManagerHandler.setExternalData(o.packageContainers, o.expectedPackages)
			}
		}
	}
	getExpectationManager(): ExpectationManager {
		return this.packageManagerHandler.getExpectationManager()
	}
}
