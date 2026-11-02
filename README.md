# AWS SaaS Operations workshop

This is the source code for the [AWS SaaS Operations workshop](https://catalog.workshops.aws/saas-operations/en-US).

If you would like to deploy this, then follow the instructions [in the workshop.](https://catalog.workshops.aws/saas-operations/en-US/0005-getting-started/020-own-account).

## How the deployment works

`deployment/deploy-workshop.sh` creates the `SaaSOps` CloudFormation stack from `deployment/WorkshopStack.yaml`. That stack starts a CodeBuild project which:

1. deploys the workshop IDE, [AWS Code Editor](https://catalog.workshops.aws/docs/en-US/cookbook/cloudformation/codeeditor) on EC2 behind CloudFront (`deployment/code-editor/code-editor.yaml`, vendored from the Workshop Studio cookbook);
2. clones this repository onto the IDE instance at `~/environment/aws-saas-operations-workshop` and runs `deployment/create-workshop.sh` there to build the SaaS application;
3. returns the IDE link as the `CodeEditorUrl` output of the `SaaSOps` stack.

Design decisions are recorded in [docs/adr](docs/adr/README.md).

There is also a second version of the workshop available, [AWS SaaS Operations workshop 2](https://catalog.workshops.aws/saas-operations-2), which follows the SaaS journey of building the control plane.

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This library is licensed under the MIT-0 License. See the LICENSE file.
