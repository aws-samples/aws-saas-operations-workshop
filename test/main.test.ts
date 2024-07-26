import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { ControlPlaneStack } from '../src/controlplane.stack';

test('Snapshot', () => {
  const app = new App();
  const stack = new ControlPlaneStack(app, 'test', {
    applicationName: 'test',
  });

  const template = Template.fromStack(stack);
  expect(template.toJSON()).toMatchSnapshot();
});