// eslint-disable-next-line node/no-extraneous-import
import { ExpectedPackageStatusAPI } from '@sofie-automation/shared-lib/dist/package-manager/package'
import { stringifyError } from '@sofie-package-manager/api'
import { TrackedExpectation } from '../../lib/trackedExpectation'
import { assertState, EvaluateContext } from '../lib'

/**
 * Evaluate a TrackedExpectation which is in the WAITING state.
 * The WAITING state means that an Expectation is waiting to be started working on.
 * When the Expectation is Ready to start workin on, it will be moved to the state READY.
 * Or, if it turns out that the Expectation is already Fulfilled, it will be moved to FULFILLED right away.
 */
export async function evaluateExpectationStateWaiting({
	manager,
	tracker,
	runner,
	trackedExp,
}: EvaluateContext): Promise<void> {
	assertState(trackedExp, ExpectedPackageStatusAPI.WorkStatusState.WAITING)

	// Check if the expectation is ready to start:
	if (!trackedExp.session) trackedExp.session = {}
	await manager.assignWorkerToSession(trackedExp)

	if (trackedExp.session.assignedWorker) {
		try {
			// First, check if it is already fulfilled:
			const fulfilled = await trackedExp.session.assignedWorker.worker.isExpectationFullfilled(
				trackedExp.exp,
				false
			)
			if (fulfilled.fulfilled) {
				// The expectation is already fulfilled:
				tracker.updateTrackedExpectationStatus(trackedExp, {
					state: ExpectedPackageStatusAPI.WorkStatusState.FULFILLED,
				})
				if (tracker.onExpectationFullfilled(trackedExp)) {
					// Something was triggered, run again ASAP:
					trackedExp.session.triggerOtherExpectationsAgain = true
				}
			} else {
				const readyToStart = await tracker.isExpectationReadyToStartWorkingOn(
					trackedExp.session.assignedWorker.worker,
					trackedExp
				)

				const newStatus: Partial<TrackedExpectation['status']> = {}
				if (readyToStart.sourceExists !== undefined) newStatus.sourceExists = readyToStart.sourceExists

				if (readyToStart.ready) {
					tracker.updateTrackedExpectationStatus(trackedExp, {
						state: ExpectedPackageStatusAPI.WorkStatusState.READY,
						reason: {
							user: 'About to start working..',
							tech: `About to start, was not fulfilled: ${fulfilled.reason.tech}`,
						},
						status: newStatus,
					})
				} else {
					// Not ready to start
					if (readyToStart.isWaitingForAnother) {
						// Not ready to start because it's waiting for another expectation to be fullfilled first
						// Stay here in WAITING state:
						tracker.updateTrackedExpectationStatus(trackedExp, {
							reason: readyToStart.reason,
							status: newStatus,
						})
					} else {
						// Not ready to start because of some other reason (e.g. the source doesn't exist)
						tracker.updateTrackedExpectationStatus(trackedExp, {
							state: ExpectedPackageStatusAPI.WorkStatusState.NEW,
							reason: readyToStart.reason,
							status: newStatus,
						})
					}
				}
			}
		} catch (error) {
			// There was an error, clearly it's not ready to start
			runner.logger.warn(`Error in WAITING: ${stringifyError(error)}`)

			tracker.updateTrackedExpectationStatus(trackedExp, {
				state: ExpectedPackageStatusAPI.WorkStatusState.NEW,
				reason: {
					user: 'Restarting due to error',
					tech: `Error from worker ${trackedExp.session.assignedWorker.id}: "${stringifyError(error)}"`,
				},
				isError: true,
			})
		}
	} else {
		// No worker is available at the moment.
		// Do nothing, hopefully some will be available at a later iteration
		tracker.noWorkerAssigned(trackedExp)
	}
}
