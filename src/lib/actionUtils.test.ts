/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { describe, expect, it } from 'vitest'
import { create, type JsonObject } from '@bufbuild/protobuf'
import { KeyValuePairSchema } from '@/gen/flyteidl2/core/literals_pb'
import { TaskSpecSchema } from '@/gen/flyteidl2/task/task_definition_pb'
import { getMergedRunAndTaskEnvs } from './actionUtils'

describe('getMergedRunAndTaskEnvs', () => {
  const podTask = (containers: JsonObject[]) =>
    create(TaskSpecSchema, {
      taskTemplate: {
        target: { case: 'k8sPod', value: { podSpec: { containers } } },
      },
    })
  const env = (key: string, value: string) =>
    create(KeyValuePairSchema, { key, value })

  it('keeps Kubernetes references out of rerun overrides and preserves literal values', () => {
    const task = podTask([
      {
        name: 'primary',
        env: [
          {
            name: 'AWS_ACCESS_KEY_ID',
            valueFrom: { secretKeyRef: { name: 'storage', key: 'access-key' } },
          },
          {
            name: 'AWS_SECRET_ACCESS_KEY',
            valueFrom: { secretKeyRef: { name: 'storage', key: 'secret-key' } },
          },
          {
            name: 'CONFIG',
            valueFrom: { configMapKeyRef: { name: 'settings', key: 'config' } },
          },
          {
            name: 'POD_NAME',
            valueFrom: { fieldRef: { fieldPath: 'metadata.name' } },
          },
          {
            name: 'CPU_LIMIT',
            valueFrom: { resourceFieldRef: { resource: 'limits.cpu' } },
          },
          { name: 'AWS_REGION', value: 'eu-north1' },
          { name: 'EMPTY', value: '' },
          { name: 'DEFAULT_EMPTY' },
        ],
      },
    ])

    expect(getMergedRunAndTaskEnvs([], task)).toEqual([
      { key: 'AWS_REGION', value: 'eu-north1' },
      { key: 'EMPTY', value: '' },
      { key: 'DEFAULT_EMPTY', value: '' },
    ])
  })

  it.each([false, true])(
    'does not shadow a reference with another container’s literal (reversed=%s)',
    (reverse) => {
      const containers: JsonObject[] = [
        {
          name: 'primary',
          env: [
            {
              name: 'TOKEN',
              valueFrom: { secretKeyRef: { name: 'service', key: 'token' } },
            },
          ],
        },
        { name: 'sidecar', env: [{ name: 'TOKEN', value: 'sidecar-value' }] },
      ]
      expect(
        getMergedRunAndTaskEnvs(
          [],
          podTask(reverse ? containers.reverse() : containers),
        ),
      ).toEqual([])
    },
  )

  it('preserves explicit run and user overrides for referenced variables', () => {
    const task = podTask([
      {
        env: [
          {
            name: 'TOKEN',
            valueFrom: { secretKeyRef: { name: 'service', key: 'token' } },
          },
        ],
      },
    ])
    const runEnvs = [env('TOKEN', 'explicit-run-value')]
    expect(getMergedRunAndTaskEnvs(runEnvs, task)).toEqual([
      { key: 'TOKEN', value: 'explicit-run-value' },
    ])
    expect(getMergedRunAndTaskEnvs(runEnvs, task, [env('TOKEN', '')])).toEqual([
      { key: 'TOKEN', value: '' },
    ])
  })

  it('preserves container-target literals and the existing override precedence', () => {
    const task = create(TaskSpecSchema, {
      taskTemplate: {
        target: {
          case: 'container',
          value: {
            env: [
              { key: 'MODE', value: 'task' },
              { key: 'EMPTY', value: '' },
            ],
          },
        },
      },
    })
    expect(getMergedRunAndTaskEnvs([env('MODE', 'run')], task)).toEqual([
      { key: 'MODE', value: 'task' },
      { key: 'EMPTY', value: '' },
    ])
    expect(
      getMergedRunAndTaskEnvs([], task, [env('MODE', 'override')]),
    ).toEqual([
      { key: 'MODE', value: 'override' },
      { key: 'EMPTY', value: '' },
    ])
  })
})
