import { Container } from 'typedi';
import { Flags, type Config } from '@oclif/core';
import { ApplicationError, sleep } from 'n8n-workflow';

import config from '@/config';
import { ActiveExecutions } from '@/ActiveExecutions';
import { WebhookServer } from '@/WebhookServer';
import { Queue } from '@/Queue';
import { BaseCommand } from './BaseCommand';

import { OrchestrationWebhookService } from '@/services/orchestration/webhook/orchestration.webhook.service';
import { OrchestrationHandlerWebhookService } from '@/services/orchestration/webhook/orchestration.handler.webhook.service';

export class Webhook extends BaseCommand {
	static description = 'Starts n8n webhook process. Intercepts only production URLs.';

	static examples = ['$ n8n webhook'];

	static flags = {
		help: Flags.help({ char: 'h' }),
	};

	protected server = Container.get(WebhookServer);

	constructor(argv: string[], cmdConfig: Config) {
		super(argv, cmdConfig);
		this.setInstanceType('webhook');
		if (this.queueModeId) {
			this.logger.debug(`Webhook Instance queue mode id: ${this.queueModeId}`);
		}
		this.setInstanceQueueModeId();
	}

	/**
	 * Stops n8n in a graceful way.
	 * Make for example sure that all the webhooks from third party services
	 * get removed.
	 */
	async stopProcess() {
		this.logger.info('\nStopping n8n...');

		try {
			await this.externalHooks?.run('n8n.stop', []);

			// Wait for active workflow executions to finish
			const activeExecutionsInstance = Container.get(ActiveExecutions);
			let executingWorkflows = activeExecutionsInstance.getActiveExecutions();

			let count = 0;
			while (executingWorkflows.length !== 0) {
				if (count++ % 4 === 0) {
					this.logger.info(
						`Waiting for ${executingWorkflows.length} active executions to finish...`,
					);
				}

				await sleep(500);
				executingWorkflows = activeExecutionsInstance.getActiveExecutions();
			}
		} catch (error) {
			await this.exitWithCrash('There was an error shutting down n8n.', error);
		}

		await this.exitSuccessFully();
	}

	async init() {
		if (config.getEnv('executions.mode') !== 'queue') {
			/**
			 * It is technically possible to run without queues but
			 * there are 2 known bugs when running in this mode:
			 * - Executions list will be problematic as the main process
			 * is not aware of current executions in the webhook processes
			 * and therefore will display all current executions as error
			 * as it is unable to determine if it is still running or crashed
			 * - You cannot stop currently executing jobs from webhook processes
			 * when running without queues as the main process cannot talk to
			 * the webhook processes to communicate workflow execution interruption.
			 */

			this.error('Webhook processes can only run with execution mode as queue.');
		}

		await this.initCrashJournal();
		this.logger.debug('Crash journal initialized');

		this.logger.info('Initializing n8n webhook process');
		this.logger.debug(`Queue mode id: ${this.queueModeId}`);

		await super.init();

		await this.initLicense();
		this.logger.debug('License init complete');
		await this.initOrchestration();
		this.logger.debug('Orchestration init complete');
		await this.initBinaryDataService();
		this.logger.debug('Binary data service init complete');
		await this.initExternalHooks();
		this.logger.debug('External hooks init complete');
		await this.initExternalSecrets();
		this.logger.debug('External seecrets init complete');
	}

	async run() {
		if (config.getEnv('multiMainSetup.enabled')) {
			throw new ApplicationError(
				'Webhook process cannot be started when multi-main setup is enabled.',
			);
		}

		await Container.get(Queue).init();
		await this.server.start();
		this.logger.debug(`Webhook listener ID: ${this.server.uniqueInstanceId}`);
		this.logger.info('Webhook listener waiting for requests.');

		// Make sure that the process does not close
		await new Promise(() => {});
	}

	async catch(error: Error) {
		await this.exitWithCrash('Exiting due to an error.', error);
	}

	async initOrchestration() {
		await Container.get(OrchestrationWebhookService).init();
		await Container.get(OrchestrationHandlerWebhookService).init();
	}
}
