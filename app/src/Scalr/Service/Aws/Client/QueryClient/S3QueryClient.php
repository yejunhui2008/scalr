<?php
namespace Scalr\Service\Aws\Client\QueryClient;

use Scalr\Service\Aws;
use Scalr\Service\Aws\Client\QueryClient;
use Scalr\Service\Aws\Event\EventType;

/**
 * Amazon S3 Query API client.
 *
 * HTTP Query-based requests are defined as any HTTP requests using the HTTP verb GET or POST
 * and a Query parameter named either Action or Operation.
 *
 * @author    Vitaliy Demidov   <vitaliy@scalr.com>
 * @since     09.11.2012
 */
class S3QueryClient extends QueryClient
{

    /**
     * Gets the list of the allowed sub-resources
     *
     * @return   array Returns the list
     */
    public static function getAllowedSubResources ()
    {
        return array(
            'acl', 'lifecycle', 'location', 'logging', 'notification', 'partNumber',
            'policy', 'requestPayment', 'torrent', 'uploadId', 'uploads', 'versionId',
            'versioning', 'versions', 'website'
        );
    }

    /**
     * Calls Amazon web service method.
     *
     * It ensures execution of the certain AWS action by transporting the request
     * and receiving response.
     *
     * @param     string    $action           REST METHOD (GET|PUT|DELETE|HEAD etc).
     * @param     array     $options          An options array. It's used to send headers for the HTTP request.
     *                                        extra options: _subdomain, _putData, _putFile
     * @param     string    $path    optional A relative path.
     * @return    ClientResponseInterface
     * @throws    ClientException
     */
    public function call($action, $options, $path = '/')
    {
        $httpRequest = $this->createRequest();

        $httpMethod = $action ?: 'GET';

        if (substr($path, 0, 1) !== '/') {
            $path = '/' . $path;
        }

        $this->lastApiCall = null;

        $eventObserver = $this->getAws()->getEventObserver();
        if ($eventObserver && $eventObserver->isSubscribed(EventType::EVENT_SEND_REQUEST)) {
            foreach (debug_backtrace() as $arr) {
                if (empty($arr['class']) ||
                    !preg_match("/\\\\Service\\\\Aws\\\\.+Api$/", $arr['class']) ||
                    $arr['type'] !== '->') {
                    continue;
                }
                $this->lastApiCall = ucfirst($arr['function']);
                break;
            }
        }

        //Wipes out extra options from headers and moves them to separate array.
        //It also collects an x-amz headers.
        $extraOptions = ['region' => null];
        foreach ($options as $key => $val) {
            if (substr($key, 0, 1) === '_') {
                $extraOptions[substr($key, 1)] = $val;
                unset($options[$key]);
            }
        }

        if (!isset($options['Host'])) {
            $options['Host'] = (isset($extraOptions['subdomain']) ? $extraOptions['subdomain'] . '.' : '') . $this->url;
        }

        if (strpos($options['Host'], 'http') === 0) {
            $arr = parse_url($options['Host']);
            $scheme = $arr['scheme'];
            $options['Host'] = $arr['host'] . (isset($arr['port']) ? ':' . $arr['port'] : '');
            $path = (!empty($arr['path']) && $arr['path'] != '/' ? rtrim($arr['path'], '/') : '') . $path;
        } else {
            $scheme = 'https';
        }

        if ($httpMethod === 'PUT' || $httpMethod === 'POST') {
            if (array_key_exists('putData', $extraOptions)) {
                if ($httpMethod === 'PUT') {
                    $httpRequest->setPutData($extraOptions['putData']);
                } else {
                    $httpRequest->setBody($extraOptions['putData']);
                }
                if (!isset($options['Content-Length'])) {
                    $options['Content-Length'] = strlen($extraOptions['putData']);
                }
                if (!isset($options['Content-Md5']) && !empty($options['Content-Length'])) {
                    $options['Content-Md5'] = Aws::getMd5Base64Digest($extraOptions['putData']);
                }
            } elseif (array_key_exists('putFile', $extraOptions)) {
                if ($httpMethod === 'PUT') {
                    $httpRequest->setPutFile($extraOptions['putFile']);
                } else {
                    $httpRequest->setBody(file_get_contents($extraOptions['putFile']));
                }
                if (!isset($options['Content-Length'])) {
                    $options['Content-Length'] = filesize($extraOptions['putFile']);
                }
                if (!isset($options['Content-Md5']) && !empty($options['Content-Length'])) {
                    $options['Content-Md5'] = Aws::getMd5Base64DigestFile($extraOptions['putFile']);
                }
            }
        }

        $httpRequest->setUrl($scheme . '://' . $options['Host'] . $path);

        $httpRequest->setMethod(constant('HTTP_METH_' . $httpMethod));

        $httpRequest->addHeaders($options);

        //Signature version 4 sign for China region
        if (preg_match('/^(cn|eu\-central)\-/', ($extraOptions['region'] ?: $this->getAws()->getRegion() ?: ''))) {
            $this->signRequestV4($httpRequest, (!empty($extraOptions['region']) ? $extraOptions['region'] : null));
        } else {
            $this->signRequestV3($httpRequest, (isset($extraOptions['subdomain']) ? $extraOptions['subdomain'] : null));
        }

        $response = $this->tryCall($httpRequest);

        if ($this->getAws() && $this->getAws()->getDebug()) {
            echo "\n";
            echo $httpRequest->getRawRequestMessage() . "\n";
            echo $httpRequest->getRawResponseMessage() . "\n";
        }

        return $response;
    }

    /**
     * Signs request with signature v3
     *
     * @param   \HttpRequest   $request    Http request
     * @param   string         $subdomain  optional A subdomain
     */
    protected function signRequestV3($request, $subdomain = null)
    {
        $time = time();

        //Gets the http method name
        $httpMethod = self::$httpMethods[$request->getMethod()];

        $components = parse_url($request->getUrl());

        //Retrieves headers from request
        $options = $request->getHeaders();

        //Adding timestamp
        if (!isset($options['Date'])) {
            $options['Date'] = gmdate('r', $time);

            $request->addHeaders([
                'Date' => $options['Date']
            ]);
        }

        //This also includes a mock objects which look like "Mock_S3QueryClient_d65a1dc1".
        if (preg_match('#(?<=[_\\\\])S3QueryClient(?=_|$)#', get_class($this))) {
            $amzHeaders = [];
            foreach ($options as $key => $val) {
                if (preg_match('/^x-amz-/i', $key)) {
                    //Saves amz headers which are used to sign the request
                    $amzHeaders[strtolower($key)] = $val;
                }
            }

            //S3 Client has a special Authorization string
            $canonicalizedAmzHeaders = '';
            if (!empty($amzHeaders)) {
                ksort($amzHeaders);

                foreach ($amzHeaders as $k => $v) {
                    $canonicalizedAmzHeaders .= $k . ':' . trim(preg_replace('/#( *[\r\n]+ *)+#/', ' ', $v)) . "\n";
                }
            }

            //Note that in case of multiple sub-resources, sub-resources must be lexicographically sorted
            //by sub-resource name and separated by '&'. e.g. ?acl&versionId=value.
            if (!empty($components['query'])) {
                $canonPath = $components['path'] . '?';

                parse_str($components['query'], $subresources);

                ksort($subresources);

                $allowed = $this->getAllowedSubResources();

                foreach ($subresources as $k => $v) {
                    if (in_array($k, $allowed)) {
                        $canonPath .= $k . ($v !== '' ? '=' . $v : '' ) . '&';
                    }
                }

                $canonPath = substr($canonPath, 0, -1);
            }

            $canonicalizedResource = (isset($subdomain) ? '/' . strtolower($subdomain) : '')
              . (isset($canonPath) ? $canonPath :
                 $components['path']
                 . (!empty($components['query']) ? '?' . $components['query'] : '')
                 . (!empty($components['fragment']) ? '#' . $components['fragment'] : ''));

            $stringToSign =
                $httpMethod . "\n"
              . (!empty($options['Content-Md5']) ? $options['Content-Md5'] . '' : '') . "\n"
              . (!empty($options['Content-Type']) ? $options['Content-Type'] . '' : '') . "\n"
              . (isset($amzHeaders['x-amz-date']) ? '' : $options['Date'] . "\n")
              . $canonicalizedAmzHeaders . $canonicalizedResource
            ;

            $options['Authorization'] = "AWS " . $this->awsAccessKeyId . ":"
              . base64_encode(hash_hmac('sha1', $stringToSign, $this->secretAccessKey, 1));
        } else {
            $options['Authorization'] = "AWS " . $this->awsAccessKeyId . ":"
              . base64_encode(hash_hmac('sha1', $options['Date'], $this->secretAccessKey, 1));
        }

        $request->addHeaders([
            'Authorization' => $options['Authorization']
        ]);
    }
}