import { SendTaskFailureCommand, SendTaskSuccessCommand, SFNClient } from '@aws-sdk/client-sfn';
import { EventBridgeEvent, EventBridgeHandler } from 'aws-lambda';
import { ControlPlaneEventBusDetailType, Status } from '../../config';

const client = new SFNClient();

interface sfnCallbackRequest {
  status: Status;
  taskToken: string;
  output?: string;
}
type SfnCallbackHandler = EventBridgeHandler<ControlPlaneEventBusDetailType.SfnCallback, sfnCallbackRequest, void>;
type SfnCallbackEvent = EventBridgeEvent<ControlPlaneEventBusDetailType.SfnCallback, sfnCallbackRequest>;

export const sfnCallback: SfnCallbackHandler = async (event: SfnCallbackEvent) => {
  const input = {
    taskToken: event.detail.taskToken,
    output: JSON.stringify({
      status: event.detail.status,
      output: event.detail.output,
    }),
  };
  try {
    if (event.detail.status === Status.Succeeded) {
      await client.send(new SendTaskSuccessCommand(input));
    } else {
      await client.send(new SendTaskFailureCommand(input));
    }
  } catch (error) {
    console.log(error);
  }
};